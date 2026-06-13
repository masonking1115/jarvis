"""SnapTrade client wrapper for the Robinhood connection (read-only).

Auth model:
  - App keys SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY come from .env.
  - A per-user {userId, userSecret} is minted once via connect() and cached to
    data/snaptrade/creds.json. userSecret is a read-only access token — NOT the
    Robinhood password (the user authorizes Robinhood on SnapTrade's portal).

Responses are cached 60s to avoid hammering SnapTrade.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from backend.core.config import settings


class SnapTradeNotConfigured(Exception):
    """No SnapTrade API keys in .env."""


class SnapTradeNotConnected(Exception):
    """No registered user / linked brokerage yet."""


_client = None
_cache: dict[str, tuple[float, Any]] = {}
_CACHE_TTL = 60.0
_USER_ID = "jarvis-user"  # single-user app: one fixed SnapTrade user id


def _data_dir() -> Path:
    p = Path(settings.snaptrade_data_dir)
    if not p.is_absolute():
        p = (Path(__file__).resolve().parent.parent.parent / p).resolve()
    return p


def _creds_path() -> Path:
    return _data_dir() / "creds.json"


def _get_sdk():
    global _client
    if _client is not None:
        return _client
    if not settings.snaptrade_client_id or not settings.snaptrade_consumer_key:
        raise SnapTradeNotConfigured(
            "SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY not set in backend/.env"
        )
    try:
        from snaptrade_client import SnapTrade
    except ImportError as e:
        raise SnapTradeNotConfigured("snaptrade-python-sdk not installed") from e
    _client = SnapTrade(
        consumer_key=settings.snaptrade_consumer_key,
        client_id=settings.snaptrade_client_id,
    )
    return _client


def _load_creds() -> dict | None:
    p = _creds_path()
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:  # noqa: BLE001
        return None


def _save_creds(user_id: str, user_secret: str) -> None:
    d = _data_dir()
    d.mkdir(parents=True, exist_ok=True)
    _creds_path().write_text(json.dumps({"userId": user_id, "userSecret": user_secret}))


def _require_creds() -> dict:
    creds = _load_creds()
    if not creds:
        raise SnapTradeNotConnected(
            "No SnapTrade user registered. POST /api/robinhood/connect first."
        )
    return creds


def _cached(key: str, fn):
    now = time.time()
    hit = _cache.get(key)
    if hit and (now - hit[0]) < _CACHE_TTL:
        return hit[1]
    val = fn()
    _cache[key] = (now, val)
    return val


# ---- public API ----

def status() -> dict:
    if not settings.snaptrade_client_id or not settings.snaptrade_consumer_key:
        return {"configured": False, "connected": False,
                "reason": "SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY not set"}
    creds = _load_creds()
    if not creds:
        return {"configured": True, "connected": False,
                "reason": "No SnapTrade user registered yet"}
    try:
        accounts = _list_accounts_raw(creds)
        return {"configured": True, "connected": bool(accounts)}
    except Exception as e:  # noqa: BLE001
        return {"configured": True, "connected": False, "reason": f"snaptrade error: {e}"}


def connect() -> dict:
    """Register a SnapTrade user if needed and return a connection-portal URL."""
    sdk = _get_sdk()
    creds = _load_creds()
    if not creds:
        resp = sdk.authentication.register_snap_trade_user(body={"userId": _USER_ID})
        user_secret = resp.body["userSecret"]
        _save_creds(_USER_ID, user_secret)
        creds = {"userId": _USER_ID, "userSecret": user_secret}
    login = sdk.authentication.login_snap_trade_user(
        query_params={"userId": creds["userId"], "userSecret": creds["userSecret"]}
    )
    body = login.body
    redirect = body.get("redirectURI") if isinstance(body, dict) else None
    return {"redirect_url": redirect}


def _list_accounts_raw(creds: dict) -> list:
    sdk = _get_sdk()
    resp = sdk.account_information.list_user_accounts(
        user_id=creds["userId"], user_secret=creds["userSecret"],
    )
    return list(resp.body or [])


def fetch_normalized() -> dict:
    """Pull accounts/balances/positions/activities and normalize to the dict
    shapes sync.py consumes. Network + JSON parsing live here so sync stays pure.
    """
    creds = _require_creds()
    sdk = _get_sdk()
    accounts = _cached("accounts", lambda: _list_accounts_raw(creds))
    if not accounts:
        raise SnapTradeNotConnected("No linked brokerage accounts. Connect Robinhood first.")

    positions: list[dict] = []
    cash: list[dict] = []
    activities: list[dict] = []

    for acc in accounts:
        acc_id = acc.get("id") or acc.get("accountId")
        if not acc_id:
            continue

        bal = sdk.account_information.get_user_account_balance(
            user_id=creds["userId"], user_secret=creds["userSecret"], account_id=acc_id,
        ).body or []
        cash_total = sum(float(b.get("cash") or 0.0) for b in bal)
        cash.append({"account_id": acc_id, "amount": cash_total})

        pos = sdk.account_information.get_all_account_positions(
            user_id=creds["userId"], user_secret=creds["userSecret"], account_id=acc_id,
        ).body or []
        for p in pos:
            positions.append(_normalize_position(acc_id, p))

        try:
            acts = sdk.account_information.get_account_activities(
                account_id=acc_id, user_id=creds["userId"], user_secret=creds["userSecret"],
            ).body or []
        except Exception:  # noqa: BLE001
            acts = []
        if isinstance(acts, dict):
            acts = acts.get("data") or []
        for a in acts:
            norm = _normalize_activity(a)
            if norm:
                activities.append(norm)

    return {"positions": positions, "cash": cash, "activities": activities}


def _normalize_position(account_id: str, p: dict) -> dict:
    # SnapTrade nests: position.symbol.symbol.{symbol, description, type.code}
    sym = p.get("symbol") if isinstance(p.get("symbol"), dict) else {}
    inner = sym.get("symbol") if isinstance(sym.get("symbol"), dict) else sym
    ticker = inner.get("symbol") or inner.get("ticker") or ""
    name = inner.get("description") or inner.get("name")
    type_obj = inner.get("type") if isinstance(inner.get("type"), dict) else {}
    type_code = (type_obj.get("code") or "").lower()
    is_crypto = "crypto" in type_code
    avg = p.get("average_purchase_price")
    return {
        "account_id": account_id,
        "ticker": ticker,
        "name": name,
        "units": float(p.get("units") or p.get("quantity") or 0.0),
        "price": float(p.get("price") or 0.0),
        "cost_basis_per_share": float(avg) if avg is not None else None,
        "is_crypto": is_crypto,
    }


def _normalize_activity(a: dict) -> dict | None:
    act_id = a.get("id")
    if not act_id:
        return None
    sym = a.get("symbol")
    if isinstance(sym, dict):
        ticker = sym.get("symbol")
    elif isinstance(sym, str):
        ticker = sym
    else:
        ticker = None
    return {
        "id": str(act_id),
        "type": a.get("type") or "",
        "amount": float(a.get("amount") or 0.0),
        "symbol": ticker,
        "description": a.get("description"),
        "date": a.get("trade_date") or a.get("settlement_date") or a.get("date"),
    }
