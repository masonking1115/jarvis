"""SnapTrade data client (read-only) over Personal OAuth bearer tokens.

Auth/token machinery lives in oauth.py. Here we make the data calls: raw httpx
GETs to https://api.snaptrade.com/api/v1 with `Authorization: Bearer <token>`.
The Personal user is implied by the token — no userId/userSecret. (The Python
SDK only speaks signature auth, so it is not used for data.)

fetch_normalized() returns the exact dict shapes sync.py consumes, so sync.py /
service.py / the UI are unchanged from the previous signature-auth design.

Responses are cached 60s to avoid hammering SnapTrade.
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from backend.core.config import settings
from . import oauth

API_BASE = "https://api.snaptrade.com/api/v1"


class SnapTradeNotConfigured(Exception):
    """No SnapTrade OAuth client configured."""


class SnapTradeNotConnected(Exception):
    """Not signed in, or no linked brokerage yet."""


_cache: dict[str, tuple[float, Any]] = {}
_CACHE_TTL = 60.0


def _cached(key: str, fn):
    now = time.time()
    hit = _cache.get(key)
    if hit and (now - hit[0]) < _CACHE_TTL:
        return hit[1]
    val = fn()
    _cache[key] = (now, val)
    return val


def _bearer_get(path: str) -> Any:
    try:
        token = oauth.get_access_token()
    except oauth.OAuthError as e:
        raise SnapTradeNotConnected(str(e)) from e
    r = httpx.get(
        f"{API_BASE}{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=30,
    )
    if r.status_code == 401:
        raise SnapTradeNotConnected("SnapTrade token rejected (401) — reconnect.")
    r.raise_for_status()
    return r.json()


# ---- public API ----
def status() -> dict:
    if not settings.snaptrade_oauth_client_id:
        return {"configured": False, "connected": False,
                "reason": "SnapTrade OAuth client id not set"}
    if not oauth.has_tokens():
        return {"configured": True, "connected": False,
                "reason": "Not signed in to SnapTrade yet"}
    try:
        accounts = _list_accounts()
        if accounts:
            return {"configured": True, "connected": True}
        return {"configured": True, "connected": False,
                "reason": "Signed in, but no brokerage linked in SnapTrade yet"}
    except SnapTradeNotConnected as e:
        return {"configured": True, "connected": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"configured": True, "connected": False, "reason": f"snaptrade error: {e}"}


def connect() -> dict:
    """Begin the one-time browser OAuth sign-in; return the authorize URL to open."""
    if not settings.snaptrade_oauth_client_id:
        raise SnapTradeNotConfigured("SnapTrade OAuth client id not set")
    return {"redirect_url": oauth.start_authorization()}


def disconnect() -> dict:
    """Forget stored tokens (sign out). Synced rows are left untouched."""
    oauth.clear_tokens()
    return {"disconnected": True}


def _list_accounts() -> list:
    return list(_cached("accounts", lambda: _bearer_get("/accounts")) or [])


def fetch_normalized() -> dict:
    """Pull accounts/balances/positions/activities and normalize to the dict
    shapes sync.py consumes. Network + JSON parsing live here so sync stays pure."""
    if not oauth.has_tokens():
        raise SnapTradeNotConnected("Not signed in. Connect Robinhood first.")
    accounts = _list_accounts()
    if not accounts:
        raise SnapTradeNotConnected("No linked brokerage accounts. Connect Robinhood first.")

    positions: list[dict] = []
    cash: list[dict] = []
    activities: list[dict] = []

    for acc in accounts:
        if not isinstance(acc, dict):
            continue
        acc_id = acc.get("id") or acc.get("accountId")
        if not acc_id:
            continue

        try:
            bal = _bearer_get(f"/accounts/{acc_id}/balances") or []
        except SnapTradeNotConnected:
            raise
        except Exception:  # noqa: BLE001
            bal = []
        cash_total = sum(float(b.get("cash") or 0.0) for b in bal if isinstance(b, dict))
        cash.append({"account_id": acc_id, "amount": cash_total})

        try:
            pos = _bearer_get(f"/accounts/{acc_id}/positions") or []
        except SnapTradeNotConnected:
            raise
        except Exception:  # noqa: BLE001
            pos = []
        for p in pos:
            if isinstance(p, dict):
                positions.append(_normalize_position(acc_id, p))

        try:
            acts = _bearer_get(f"/accounts/{acc_id}/activities") or []
        except SnapTradeNotConnected:
            raise
        except Exception:  # noqa: BLE001
            acts = []
        if isinstance(acts, dict):
            acts = acts.get("data") or []
        for a in acts:
            if isinstance(a, dict):
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
