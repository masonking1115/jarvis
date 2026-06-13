"""Fitness module.

Serves activity history imported from local .FIT files (inbox folder, connected
Garmin USB device, or direct upload). No Garmin account login is used — that
flow is unreliable/rate-limited. Wellness (steps/sleep) is deferred.

`/today` still returns demo rings so the dashboard always renders.
"""
import os
import sys
from pathlib import Path

from fastapi import APIRouter, UploadFile, File

from backend.core.db import SessionLocal
from backend.modules.fitness import models, ingest
from backend.modules.fitness.scheduler import start as start_scheduler

router = APIRouter()

_PLACEHOLDER = {
    "placeholder": True,
    "source": "demo",
    "rings": [
        {"name": "Move",     "value": 542, "goal": 700, "unit": "cal", "color": "#4ad6ff"},
        {"name": "Exercise", "value": 38,  "goal": 60,  "unit": "min", "color": "#22e8a0"},
        {"name": "Stand",    "value": 9,   "goal": 12,  "unit": "hr",  "color": "#ffb547"},
    ],
    "distance_mi": 8.42,
    "wellness_pct": 82,
}


def _activity_summary(a: models.FitActivity) -> dict:
    return {
        "id": a.id,
        "filename": a.filename,
        "sport": a.sport, "sub_sport": a.sub_sport,
        "start_time": a.start_time.isoformat() if a.start_time else None,
        "duration_s": a.duration_s, "distance_m": a.distance_m,
        "avg_hr": a.avg_hr, "max_hr": a.max_hr, "avg_speed": a.avg_speed,
        "calories": a.calories, "total_ascent": a.total_ascent,
    }


@router.get("/today")
def today():
    # Wellness is deferred (no login source); dashboard shows demo rings for now.
    return _PLACEHOLDER


@router.get("/activities")
def activities(limit: int = 25, offset: int = 0):
    db = SessionLocal()
    try:
        q = (db.query(models.FitActivity)
               .order_by(models.FitActivity.start_time.desc().nullslast(),
                         models.FitActivity.created_at.desc())
               .offset(offset).limit(limit))
        return {"activities": [_activity_summary(a) for a in q.all()]}
    finally:
        db.close()


@router.get("/activities/{activity_id}")
def activity_detail(activity_id: int):
    db = SessionLocal()
    try:
        a = db.get(models.FitActivity, activity_id)
        if a is None:
            return {"available": False, "reason": "not found"}
        out = _activity_summary(a)
        out["samples"] = a.samples or []
        return out
    finally:
        db.close()


@router.get("/wellness")
def wellness(days: int = 14):
    # Deferred: no login-based wellness source. Returns empty until FIT monitoring
    # files (from a bulk export) are parsed in a future pass.
    return {"days": []}


@router.post("/import")
async def import_files(files: list[UploadFile] = File(...)):
    """Upload one or more .FIT (or .zip-of-fit) files for immediate import."""
    results = []
    for f in files:
        blob = await f.read()
        safe_name = Path(f.filename).name if f.filename else None  # strip any path components
        results.append(ingest.import_fit_bytes(blob, filename=safe_name))
    return {"results": results}


@router.post("/import/scan")
def import_scan():
    """Trigger an immediate inbox + connected-device scan."""
    return ingest.run_import()


@router.get("/import/status")
def import_status():
    db = SessionLocal()
    try:
        row = db.get(models.SyncState, 1)
        count = db.query(models.FitActivity).count()
    finally:
        db.close()
    return {
        "inbox_dir": str(ingest.inbox_dir()),
        "interval_min": int(os.getenv("FITNESS_SYNC_INTERVAL_MIN", "10")),
        "last_status": row.last_status if row else "never",
        "last_sync_at": row.last_sync_at.isoformat() if row and row.last_sync_at else None,
        "last_error": row.last_error if row else None,
        "items_synced": row.items_synced if row else 0,
        "activity_count": count,
    }


# Kick off the background import scanner when this module is mounted. Skipped
# under pytest so importing the router doesn't spawn a drive-scanning thread.
if "pytest" not in sys.modules:
    start_scheduler()
