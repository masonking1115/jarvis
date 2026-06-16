"""On-disk storage for the local tax vault.

Files live under backend/data/tax/<year>/ — same data root as the rest of
JARVIS (gmail tokens, sqlite db). Local-only: nothing leaves the machine.
"""
from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path
from uuid import uuid4

from backend.core.config import settings


def vault_dir() -> Path:
    """Root of the tax vault: backend/data/tax (created on demand)."""
    base = Path(getattr(settings, "gmail_data_dir", "./data/gmail"))
    # Resolve relative to backend/ (same anchor db.py / oauth.py use), then swap
    # the leaf for 'tax' so we sit beside the other data dirs regardless of config.
    if not base.is_absolute():
        base = (Path(__file__).resolve().parent.parent.parent / base).resolve()
    root = base.parent / "tax"
    root.mkdir(parents=True, exist_ok=True)
    return root


def year_dir(year: int) -> Path:
    d = vault_dir() / str(int(year))
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe(name: str) -> str:
    """Keep a readable but filesystem-safe version of the original filename."""
    name = Path(name or "file").name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_.") or "file"
    return name[:120]


def save(year: int, original_name: str, blob: bytes) -> tuple[str, int]:
    """Write bytes to the year folder under a collision-proof name.
    Returns (stored_name, size_bytes)."""
    stored_name = f"{uuid4().hex}_{_safe(original_name)}"
    path = year_dir(year) / stored_name
    path.write_bytes(blob)
    return stored_name, len(blob)


def path_for(year: int, stored_name: str) -> Path:
    # Guard against path traversal — only ever a bare filename in the year dir.
    return year_dir(year) / Path(stored_name).name


def delete(year: int, stored_name: str) -> bool:
    p = path_for(year, stored_name)
    try:
        p.unlink()
        return True
    except FileNotFoundError:
        return False


def guess_doc_type(filename: str) -> str:
    """Best-effort doc-type tag from the filename (user can edit it)."""
    n = (filename or "").lower()
    if "w-2" in n or "w2" in n:
        return "w2"
    if "1099-b" in n or "1099b" in n:
        return "1099-b"
    if "1099-int" in n or "1099int" in n:
        return "1099-int"
    if "1099-div" in n or "1099div" in n:
        return "1099-div"
    if "robinhood" in n:           # brokerage consolidated 1099
        return "1099-b"
    if "1099" in n:
        return "1099-int"
    if "1098" in n or "edfinancial" in n or "student" in n:  # student-loan interest
        return "1098"
    if "1040" in n or "return" in n:
        return "return"
    return "other"


def is_zip(filename: str | None, content_type: str | None) -> bool:
    name = (filename or "").lower()
    ct = (content_type or "").lower()
    return name.endswith(".zip") or "zip" in ct


def extract_zip(blob: bytes) -> list[tuple[str, bytes]]:
    """Return (filename, bytes) for each real file in a zip.
    Skips directories, macOS metadata, and dotfiles."""
    out: list[tuple[str, bytes]] = []
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            base = Path(info.filename).name
            if not base or base.startswith(".") or "__MACOSX" in info.filename:
                continue
            data = z.read(info)
            if data:
                out.append((base, data))
    return out
