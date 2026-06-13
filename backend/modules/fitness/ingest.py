"""Import Garmin .FIT files from local sources — no account login required.

Acquisition is file-based (the Garmin SSO API login is unreliable / rate-limited):

  - Inbox folder (default backend/data/fit_inbox/): files dropped here are
    imported, then moved to processed/ (or failed/). Configurable via
    FITNESS_INBOX_DIR.
  - Connected Garmin USB device: most watches mount as a drive exposing
    GARMIN/ACTIVITY/*.fit; those are imported read-only (never moved/deleted).
  - Direct uploads: the API calls import_fit_bytes() with the uploaded bytes.

Parsing uses the official FIT SDK via fit_parser.parse_activity. De-dup is by
sha256 of the .FIT bytes, because FIT files do not carry Garmin's activityId.
"""
from __future__ import annotations

import hashlib
import io
import os
import shutil
import string
import threading
import zipfile
from datetime import datetime
from pathlib import Path

from sqlalchemy.exc import IntegrityError

from backend.core.db import SessionLocal
from backend.modules.fitness.fit_parser import parse_activity, FitParseError
from backend.modules.fitness import models

# Real .FIT files are a few MB at most; this guards against accidental huge
# drops and zip-bomb uploads.
_MAX_FIT_BYTES = 50 * 1024 * 1024

# Serialises run_import() across the scheduler thread and API-triggered scans.
_import_lock = threading.Lock()


# --- paths -----------------------------------------------------------------

def inbox_dir() -> Path:
    """Folder watched for dropped .FIT/.zip files. Lives next to the DB."""
    env = os.getenv("FITNESS_INBOX_DIR")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parents[2] / "data" / "fit_inbox"  # backend/data/fit_inbox


def _ensure_dirs(base: Path) -> tuple[Path, Path]:
    base.mkdir(parents=True, exist_ok=True)
    processed = base / "processed"
    failed = base / "failed"
    processed.mkdir(exist_ok=True)
    failed.mkdir(exist_ok=True)
    return processed, failed


# --- core import -----------------------------------------------------------

def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _extract_fit(blob: bytes) -> bytes:
    """A .zip (e.g. Garmin 'Export Original') wraps the .fit; raw bytes pass through."""
    if len(blob) > _MAX_FIT_BYTES:
        raise FitParseError(f"file too large ({len(blob)} bytes)")
    if blob[:4] == b"PK\x03\x04":
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            name = next((n for n in zf.namelist() if n.lower().endswith(".fit")), None)
            if name is None:
                raise FitParseError("zip contains no .fit file")
            if zf.getinfo(name).file_size > _MAX_FIT_BYTES:
                raise FitParseError("decompressed .fit too large")
            return zf.read(name)
    return blob


def import_fit_bytes(blob: bytes, filename: str | None = None) -> dict:
    """Parse + store one .FIT (or zip-of-fit). De-dups by content hash.

    Returns {"status": "imported"|"duplicate"|"error", "filename", ...}.
    Never raises.
    """
    try:
        fit = _extract_fit(blob)
        digest = _hash(fit)
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "filename": filename, "reason": str(e)}

    db = SessionLocal()
    try:
        existing = db.query(models.FitActivity).filter_by(fit_hash=digest).one_or_none()
        if existing is not None:
            return {"status": "duplicate", "filename": filename, "id": existing.id}

        try:
            parsed = parse_activity(fit)
        except Exception as e:  # noqa: BLE001
            return {"status": "error", "filename": filename, "reason": str(e)}

        row = models.FitActivity(
            fit_hash=digest, filename=filename,
            sport=parsed["sport"], sub_sport=parsed["sub_sport"],
            start_time=parsed["start_time"], duration_s=parsed["duration_s"],
            distance_m=parsed["distance_m"], avg_hr=parsed["avg_hr"],
            max_hr=parsed["max_hr"], avg_speed=parsed["avg_speed"],
            calories=parsed["calories"], total_ascent=parsed["total_ascent"],
            samples=parsed["samples"], source="fit_import",
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            # A concurrent import committed the same fit_hash first — treat as dup.
            db.rollback()
            return {"status": "duplicate", "filename": filename}
        return {"status": "imported", "filename": filename, "id": row.id}
    finally:
        db.close()


# --- sources ---------------------------------------------------------------

def _is_fit_file(name: str) -> bool:
    low = name.lower()
    return low.endswith(".fit") or low.endswith(".zip")


def scan_inbox() -> list[dict]:
    """Import every .fit/.zip in the inbox, moving each to processed/ or failed/."""
    base = inbox_dir()
    processed, failed = _ensure_dirs(base)
    results: list[dict] = []
    for entry in sorted(base.iterdir()):
        if entry.is_dir() or not _is_fit_file(entry.name):
            continue
        try:
            blob = entry.read_bytes()
        except Exception as e:  # noqa: BLE001
            results.append({"status": "error", "filename": entry.name, "reason": str(e)})
            continue
        res = import_fit_bytes(blob, filename=entry.name)
        results.append(res)
        dest = (failed if res["status"] == "error" else processed) / entry.name
        try:
            shutil.move(str(entry), str(dest))
        except Exception:  # noqa: BLE001 - if move fails, dedup still prevents re-import
            pass
    return results


def _garmin_activity_dirs() -> list[Path]:
    """Find GARMIN/ACTIVITY folders on connected drives (Windows drive letters)."""
    dirs: list[Path] = []
    for letter in string.ascii_uppercase:
        root = Path(f"{letter}:/")
        try:
            cand = root / "GARMIN" / "ACTIVITY"
            if cand.is_dir():
                dirs.append(cand)
        except Exception:  # noqa: BLE001 - inaccessible drive
            continue
    return dirs


def scan_garmin_devices() -> list[dict]:
    """Import .fit files straight off a plugged-in Garmin device (read-only)."""
    results: list[dict] = []
    for activity_dir in _garmin_activity_dirs():
        try:
            entries = sorted(activity_dir.iterdir())
        except Exception:  # noqa: BLE001
            continue
        for entry in entries:
            if entry.is_dir() or not entry.name.lower().endswith(".fit"):
                continue
            try:
                blob = entry.read_bytes()
            except Exception as e:  # noqa: BLE001
                results.append({"status": "error", "filename": entry.name, "reason": str(e)})
                continue
            results.append(import_fit_bytes(blob, filename=f"{activity_dir.parent.parent.name}:{entry.name}"))
    return results


# --- orchestration ---------------------------------------------------------

def _set_state(status: str, error: str | None, items: int) -> None:
    db = SessionLocal()
    try:
        row = db.get(models.SyncState, 1)
        if row is None:
            row = models.SyncState(id=1)
            db.add(row)
        row.last_status = status
        row.last_error = error
        row.items_synced = items
        if status in ("ok", "error"):
            row.last_sync_at = datetime.utcnow()  # last attempt, success or handled error
        db.commit()
    finally:
        db.close()


def run_import() -> dict:
    """Scan inbox + connected devices, store new activities. Never raises.

    Returns {"status": "ok"|"error", "imported", "duplicate", "error"[, "reason"]}.
    """
    tally = {"imported": 0, "duplicate": 0, "error": 0}
    # Skip if a scan is already running (scheduler vs. manual /import/scan).
    if not _import_lock.acquire(blocking=False):
        return {"status": "ok", "skipped": "already running", **tally}
    try:
        for res in scan_inbox() + scan_garmin_devices():
            tally[res["status"]] = tally.get(res["status"], 0) + 1
    except Exception as e:  # noqa: BLE001
        _set_state("error", str(e), tally["imported"])
        return {"status": "error", "reason": str(e), **tally}
    finally:
        _import_lock.release()

    _set_state("ok", None, tally["imported"])
    return {"status": "ok", **tally}
