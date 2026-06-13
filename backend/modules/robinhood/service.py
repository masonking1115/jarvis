"""Sync orchestration: fetch from SnapTrade and upsert into finance tables.

Shared by the POST /sync endpoint and the background scheduler so both apply the
exact same idempotent upsert keyed on (source, external_id). Rows with any other
source (e.g. 'manual') are never touched.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from backend.modules.finance.models import Asset, Transaction
from . import client as rc
from . import sync


def sync_to_db(db: Session) -> dict:
    data = rc.fetch_normalized()
    asset_rows = [sync.cash_to_asset(c) for c in data["cash"]]
    asset_rows += [sync.position_to_asset(p) for p in data["positions"]]
    txn_rows = [sync.activity_to_transaction(a) for a in data["activities"]]

    assets_synced = _upsert_assets(db, asset_rows)
    txns_synced = _upsert_transactions(db, txn_rows)
    db.commit()

    portfolio_value = sum(r["value"] for r in asset_rows)
    return {
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
