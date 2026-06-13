"""Robinhood (via SnapTrade) endpoints — read-only.

Degrades like Garmin: when not configured/connected, endpoints return
{"available": false, "reason": ...} with HTTP 200.
"""
from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.core.db import get_db
from backend.modules.finance.models import Asset, Transaction
from . import client as rc
from . import sync

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


@router.post("/sync")
def sync_now(db: Session = Depends(get_db)):
    try:
        data = rc.fetch_normalized()
    except (rc.SnapTradeNotConfigured, rc.SnapTradeNotConnected) as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"snaptrade error: {e}"}

    asset_rows = [sync.cash_to_asset(c) for c in data["cash"]]
    asset_rows += [sync.position_to_asset(p) for p in data["positions"]]
    txn_rows = [sync.activity_to_transaction(a) for a in data["activities"]]

    assets_synced = _upsert_assets(db, asset_rows)
    txns_synced = _upsert_transactions(db, txn_rows)
    db.commit()

    portfolio_value = sum(r["value"] for r in asset_rows)
    return {
        "available": True,
        "assets_synced": assets_synced,
        "transactions_synced": txns_synced,
        "portfolio_value": round(portfolio_value, 2),
    }


def _upsert_assets(db: Session, rows: list[dict]) -> int:
    for r in rows:
        existing = (
            db.query(Asset)
            .filter(Asset.source == r["source"], Asset.external_id == r["external_id"])
            .first()
        )
        if existing:
            existing.name = r["name"]
            existing.category = r["category"]
            existing.value = r["value"]
            existing.ticker = r["ticker"]
            existing.shares = r["shares"]
            existing.cost_basis = r["cost_basis"]
            existing.last_updated = datetime.utcnow()
        else:
            db.add(Asset(**r))
    return len(rows)


def _upsert_transactions(db: Session, rows: list[dict]) -> int:
    for r in rows:
        existing = (
            db.query(Transaction)
            .filter(Transaction.source == r["source"], Transaction.external_id == r["external_id"])
            .first()
        )
        if existing:
            existing.amount = r["amount"]
            existing.category = r["category"]
            existing.description = r["description"]
            existing.occurred_at = r["occurred_at"]
        else:
            db.add(Transaction(**r))
    return len(rows)
