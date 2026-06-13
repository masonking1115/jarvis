"""Pure mapping helpers: normalized SnapTrade data -> finance row dicts.

No network, no DB. client.py normalizes raw SnapTrade SDK payloads into the
simple dict shapes consumed here; router.py upserts the returned dicts into the
assets / transactions tables keyed on (source, external_id). Keeping this pure
makes it unit-testable — it writes directly into net-worth numbers.

Normalized input shapes (produced by client.py):

  position = {account_id, ticker, name, units, price, cost_basis_per_share, is_crypto}
  cash     = {account_id, amount}
  activity = {id, type, amount, symbol, description, date}   # amount = net cash effect
"""
from __future__ import annotations

from datetime import datetime

SOURCE = "robinhood"
_BUY_TYPES = {"BUY", "REINVEST"}


def position_to_asset(pos: dict) -> dict:
    units = float(pos.get("units") or 0.0)
    price = float(pos.get("price") or 0.0)
    cps = pos.get("cost_basis_per_share")
    ticker = pos.get("ticker") or ""
    return {
        "source": SOURCE,
        "external_id": f"{pos['account_id']}:{ticker}",
        "name": pos.get("name") or ticker,
        "category": "crypto" if pos.get("is_crypto") else "stocks",
        "value": round(units * price, 2),
        "ticker": ticker or None,
        "shares": units,
        "cost_basis": round(float(cps) * units, 2) if cps is not None else None,
    }


def cash_to_asset(cash: dict) -> dict:
    return {
        "source": SOURCE,
        "external_id": f"{cash['account_id']}:CASH",
        "name": "Robinhood Cash",
        "category": "cash",
        "value": round(float(cash.get("amount") or 0.0), 2),
        "ticker": None,
        "shares": None,
        "cost_basis": None,
    }


def activity_to_transaction(act: dict) -> dict:
    amount = float(act.get("amount") or 0.0)
    a_type = (act.get("type") or "").upper()
    # Buys reduce cash. If upstream sent an unsigned positive for a buy, flip it
    # so net-worth math stays correct.
    if a_type in _BUY_TYPES and amount > 0:
        amount = -amount
    desc_bits = [b for b in (act.get("symbol"), act.get("description")) if b]
    return {
        "source": SOURCE,
        "external_id": str(act["id"]),
        "amount": round(amount, 2),
        "category": (a_type or "trade").lower(),
        "description": " · ".join(desc_bits) or None,
        "occurred_at": _parse_dt(act.get("date")),
    }


def _parse_dt(value: str | None) -> datetime:
    if not value:
        return datetime.utcnow()
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.utcnow()
