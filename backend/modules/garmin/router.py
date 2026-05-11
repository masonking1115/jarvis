"""Garmin endpoints — read-only.

All endpoints degrade gracefully: if Garmin is not configured / not
authenticated, they return {"available": false, "reason": "..."} with a
200 so the dashboard doesn't error out.
"""
from fastapi import APIRouter

from . import client as gc

router = APIRouter()


def _safe(fn):
    try:
        return {"available": True, "data": fn()}
    except (gc.GarminNotConfigured, gc.GarminNotAuthenticated) as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"garmin error: {e}"}


@router.get("/status")
def status():
    return gc.status()


@router.get("/today")
def today():
    return _safe(gc.today_summary)


@router.get("/sleep")
def sleep():
    return _safe(gc.sleep_today)


@router.get("/readiness")
def readiness():
    return _safe(gc.training_readiness)


@router.get("/vo2")
def vo2():
    return _safe(gc.vo2_max)


@router.get("/body_battery")
def battery():
    return _safe(gc.body_battery)


@router.get("/activities")
def activities(limit: int = 5):
    return _safe(lambda: gc.recent_activities(limit))
