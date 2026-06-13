"""Robinhood (via SnapTrade) endpoints — read-only.

Degrades like Garmin: when not configured/connected, endpoints return
{"available": false, "reason": ...} with HTTP 200. The upsert logic lives in
service.py so the background scheduler reuses it identically.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.core.db import get_db
from . import client as rc
from . import service

router = APIRouter()


@router.get("/status")
def status():
    return rc.status()


@router.post("/connect")
def connect():
    try:
        return {"available": True, **rc.connect()}
    except rc.SnapTradeNotConfigured as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"snaptrade error: {e}"}


@router.post("/disconnect")
def disconnect():
    return {"available": True, **rc.disconnect()}


@router.post("/sync")
def sync_now(db: Session = Depends(get_db)):
    try:
        result = service.sync_to_db(db)
    except (rc.SnapTradeNotConfigured, rc.SnapTradeNotConnected) as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"snaptrade error: {e}"}
    return {"available": True, **result}
