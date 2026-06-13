import io
import zipfile

import pytest

from backend.core.db import SessionLocal
from backend.modules.fitness import ingest, models


@pytest.fixture(autouse=True)
def clean_db():
    def _wipe():
        db = SessionLocal()
        db.query(models.FitActivity).delete()
        db.commit()
        db.close()
    _wipe()
    yield
    _wipe()


def _fake_parsed():
    return {
        "sport": "running", "sub_sport": None, "start_time": None,
        "duration_s": 1500.0, "distance_m": 5000.0, "avg_hr": 150, "max_hr": 170,
        "avg_speed": 3.0, "calories": 400, "total_ascent": 20.0, "samples": [],
    }


def _zip_of(fit_bytes: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("activity.fit", fit_bytes)
    return buf.getvalue()


def test_extract_fit_from_zip():
    assert ingest._extract_fit(_zip_of(b"FITDATA")) == b"FITDATA"


def test_extract_fit_passthrough_when_not_zip():
    assert ingest._extract_fit(b"\x0e\x10notazip") == b"\x0e\x10notazip"


def test_import_fit_bytes_imported(monkeypatch):
    monkeypatch.setattr(ingest, "parse_activity", lambda b: _fake_parsed())
    res = ingest.import_fit_bytes(b"FITBYTES-1", filename="run1.fit")
    assert res["status"] == "imported"

    db = SessionLocal()
    rows = db.query(models.FitActivity).all()
    assert len(rows) == 1
    assert rows[0].sport == "running"
    assert rows[0].filename == "run1.fit"
    assert rows[0].fit_hash  # content hash set
    db.close()


def test_import_fit_bytes_dedupes_by_content(monkeypatch):
    monkeypatch.setattr(ingest, "parse_activity", lambda b: _fake_parsed())
    first = ingest.import_fit_bytes(b"SAME-BYTES", filename="a.fit")
    second = ingest.import_fit_bytes(b"SAME-BYTES", filename="a-copy.fit")
    assert first["status"] == "imported"
    assert second["status"] == "duplicate"

    db = SessionLocal()
    assert db.query(models.FitActivity).count() == 1
    db.close()


def test_import_fit_bytes_parse_error(monkeypatch):
    def boom(_b):
        raise ValueError("bad fit")
    monkeypatch.setattr(ingest, "parse_activity", boom)
    res = ingest.import_fit_bytes(b"GARBAGE", filename="bad.fit")
    assert res["status"] == "error"

    db = SessionLocal()
    assert db.query(models.FitActivity).count() == 0
    db.close()


def test_scan_inbox_imports_and_moves(monkeypatch, tmp_path):
    monkeypatch.setenv("FITNESS_INBOX_DIR", str(tmp_path))
    monkeypatch.setattr(ingest, "parse_activity", lambda b: _fake_parsed())
    (tmp_path / "ride.fit").write_bytes(b"FITBYTES-RIDE")

    results = ingest.scan_inbox()
    assert [r["status"] for r in results] == ["imported"]
    # original moved into processed/, not left in the inbox root
    assert not (tmp_path / "ride.fit").exists()
    assert (tmp_path / "processed" / "ride.fit").exists()

    db = SessionLocal()
    assert db.query(models.FitActivity).count() == 1
    db.close()


def test_run_import_updates_sync_state(monkeypatch, tmp_path):
    monkeypatch.setenv("FITNESS_INBOX_DIR", str(tmp_path))
    monkeypatch.setattr(ingest, "scan_garmin_devices", lambda: [])  # don't touch real drives
    out = ingest.run_import()
    assert out["status"] == "ok"
    assert out["imported"] == 0

    db = SessionLocal()
    st = db.get(models.SyncState, 1)
    assert st is not None and st.last_status == "ok"
    db.close()


def test_run_import_skips_when_already_running(monkeypatch, tmp_path):
    monkeypatch.setenv("FITNESS_INBOX_DIR", str(tmp_path))
    monkeypatch.setattr(ingest, "scan_garmin_devices", lambda: [])
    ingest._import_lock.acquire()  # simulate a concurrent run in progress
    try:
        out = ingest.run_import()
    finally:
        ingest._import_lock.release()
    assert out.get("skipped") == "already running"


def test_oversize_file_is_rejected(monkeypatch):
    monkeypatch.setattr(ingest, "_MAX_FIT_BYTES", 10)
    res = ingest.import_fit_bytes(b"x" * 100, filename="big.fit")
    assert res["status"] == "error"

    db = SessionLocal()
    assert db.query(models.FitActivity).count() == 0
    db.close()
