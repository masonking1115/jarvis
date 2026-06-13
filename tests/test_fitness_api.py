import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.modules.fitness import router as fitness_router
from backend.core.db import SessionLocal
from backend.modules.fitness import models, ingest


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


def _client():
    app = FastAPI()
    app.include_router(fitness_router, prefix="/api/fitness")
    return TestClient(app)


def _seed_activity():
    db = SessionLocal()
    db.add(models.FitActivity(fit_hash="abc123", filename="seed.fit", sport="running",
                              distance_m=5000.0, duration_s=1500.0, avg_hr=150,
                              samples=[{"t": 1, "hr": 150, "speed": 3.0,
                                        "lat": None, "lon": None, "alt": None, "cad": 80}]))
    db.commit()
    aid = db.query(models.FitActivity).filter_by(fit_hash="abc123").one().id
    db.close()
    return aid


def test_activities_endpoint_returns_stored():
    aid = _seed_activity()
    c = _client()
    r = c.get("/api/fitness/activities")
    assert r.status_code == 200
    body = r.json()
    assert any(a["id"] == aid for a in body["activities"])
    assert "samples" not in body["activities"][0]  # list omits heavy samples

    detail = c.get(f"/api/fitness/activities/{aid}")
    assert detail.status_code == 200
    assert detail.json()["samples"][0]["hr"] == 150


def test_import_status_endpoint():
    c = _client()
    r = c.get("/api/fitness/import/status")
    assert r.status_code == 200
    body = r.json()
    assert "inbox_dir" in body
    assert "interval_min" in body
    assert "activity_count" in body


def test_upload_import_endpoint(monkeypatch):
    monkeypatch.setattr(ingest, "parse_activity", lambda b: {
        "sport": "cycling", "sub_sport": None, "start_time": None,
        "duration_s": 600.0, "distance_m": 2000.0, "avg_hr": 130, "max_hr": 150,
        "avg_speed": 5.0, "calories": 120, "total_ascent": 5.0, "samples": [],
    })
    c = _client()
    r = c.post("/api/fitness/import",
               files={"files": ("ride.fit", b"UPLOAD-BYTES", "application/octet-stream")})
    assert r.status_code == 200
    results = r.json()["results"]
    assert results[0]["status"] == "imported"

    db = SessionLocal()
    assert db.query(models.FitActivity).count() == 1
    db.close()


def test_import_scan_endpoint(monkeypatch):
    monkeypatch.setattr(ingest, "run_import", lambda: {"status": "ok", "imported": 2, "duplicate": 0, "error": 0})
    c = _client()
    r = c.post("/api/fitness/import/scan")
    assert r.status_code == 200
    assert r.json()["imported"] == 2
