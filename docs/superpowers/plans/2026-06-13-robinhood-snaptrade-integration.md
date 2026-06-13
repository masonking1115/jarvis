# Robinhood Integration via SnapTrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync the user's Robinhood holdings, cash, crypto, and transactions into the Finance module (read-only, via the SnapTrade SDK) and surface them to the JARVIS chat assistant.

**Architecture:** A new auto-mounted backend module `backend/modules/robinhood/` mirrors the existing Garmin integration: a `client.py` wraps the SnapTrade SDK (auth, 60s cache, graceful degradation, raw→normalized parsing), a pure `sync.py` maps normalized data into Asset/Transaction row dicts, and `router.py` exposes `/api/robinhood/{status,connect,sync}`. Synced rows are tagged `source="robinhood"` + a stable `external_id` so re-syncs upsert in place and never touch manual entries. Chat context injection makes the data readable by the assistant.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, SQLite, `snaptrade-python-sdk`, pytest (new), Next.js 14 + Tailwind.

---

## File Structure

- `backend/requirements.txt` *(modify)* — add `snaptrade-python-sdk`, `pytest`.
- `backend/.env.example` *(modify)* — document SnapTrade keys.
- `backend/core/config.py` *(modify)* — add SnapTrade settings.
- `backend/modules/finance/models.py` *(modify)* — add `source` + `external_id` to `Asset` and `Transaction`.
- `backend/core/db.py` *(modify)* — additive column migrations for `assets` + `transactions`.
- `backend/modules/finance/schemas.py` *(modify)* — expose `source`/`external_id` on `AssetOut` + `TxnOut`.
- `web/lib/api.ts` *(modify)* — add fields to `Asset`/`Txn`, add Robinhood types.
- `backend/modules/robinhood/sync.py` *(create)* — pure mapping functions.
- `tests/test_robinhood_sync.py` *(create)* — unit tests for `sync.py` (repo's first test).
- `backend/modules/robinhood/client.py` *(create)* — SnapTrade SDK wrapper + normalization.
- `backend/scripts/snaptrade_connect.py` *(create)* — optional CLI connect fallback.
- `backend/modules/robinhood/router.py` *(create)* — endpoints + DB upsert.
- `backend/modules/robinhood/__init__.py` *(create)* — exposes `router`.
- `backend/modules/chat/router.py` *(modify)* — inject finance snapshot into context.
- `web/app/(console)/finance/page.tsx` *(modify)* — Robinhood connect/sync panel.

All commands below run from the repo root `C:\Users\mking\Downloads\JARVIS\jarvis` using the project venv: `.venv\Scripts\python.exe`.

---

### Task 1: Dependencies and configuration

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/.env.example`
- Modify: `backend/core/config.py:11-22`

- [ ] **Step 1: Add the SDK and pytest to requirements**

Append to `backend/requirements.txt`:

```
snaptrade-python-sdk==11.0.154
pytest==8.3.3
```

- [ ] **Step 2: Install them**

Run: `.venv\Scripts\python.exe -m pip install snaptrade-python-sdk==11.0.154 pytest==8.3.3`
Expected: `Successfully installed snaptrade-python-sdk-... pytest-...`

- [ ] **Step 3: Verify the SDK imports**

Run: `.venv\Scripts\python.exe -c "from snaptrade_client import SnapTrade; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Add SnapTrade settings to config**

In `backend/core/config.py`, add these three fields immediately after the `garmin_token_dir` line (inside the `Settings` class):

```python
    snaptrade_client_id: str = ""
    snaptrade_consumer_key: str = ""
    snaptrade_data_dir: str = "./data/snaptrade"
```

- [ ] **Step 5: Document the keys in .env.example**

Append to `backend/.env.example`:

```
# ----------- Robinhood via SnapTrade (optional) -----------
# Sign up for free SnapTrade developer keys at https://snaptrade.com and paste
# them here. Used by /api/robinhood/* to read holdings (read-only). The per-user
# access token minted on connect is stored under data/snaptrade/ (gitignored).
SNAPTRADE_CLIENT_ID=
SNAPTRADE_CONSUMER_KEY=
SNAPTRADE_DATA_DIR=./data/snaptrade
```

- [ ] **Step 6: Verify config still loads**

Run: `.venv\Scripts\python.exe -c "from backend.core.config import settings; print(settings.snaptrade_data_dir)"`
Expected: `./data/snaptrade`

- [ ] **Step 7: Commit**

```bash
git add backend/requirements.txt backend/.env.example backend/core/config.py
git commit -m "Add SnapTrade dependency and config for Robinhood integration"
```

> Note: `data/` is already in `.gitignore`, so `data/snaptrade/creds.json` is never committed. No gitignore change needed.

---

### Task 2: Data-model columns for sync tagging

**Files:**
- Modify: `backend/modules/finance/models.py:7-13` (Transaction), `:29-40` (Asset)
- Modify: `backend/core/db.py:53-59`
- Modify: `backend/modules/finance/schemas.py:16-19` (TxnOut), `:76-80` (AssetOut)
- Modify: `web/lib/api.ts:20`, `:33`

- [ ] **Step 1: Add columns to the Transaction model**

In `backend/modules/finance/models.py`, inside `class Transaction`, add after the `occurred_at` line:

```python
    source: Mapped[str] = mapped_column(String(32), default="manual")        # manual | robinhood
    external_id: Mapped[str | None] = mapped_column(String(128), default=None)
```

- [ ] **Step 2: Add columns to the Asset model**

In the same file, inside `class Asset`, add after the `created_at` line:

```python
    source: Mapped[str] = mapped_column(String(32), default="manual")        # manual | robinhood
    external_id: Mapped[str | None] = mapped_column(String(128), default=None)
```

- [ ] **Step 3: Add the additive migrations**

In `backend/core/db.py`, extend the `additions` dict in `_apply_lightweight_migrations()` (currently only has `"events"`) so it reads:

```python
    additions = {
        "events": [
            ("category",     "VARCHAR(32) DEFAULT 'general'"),
            ("completed",    "BOOLEAN DEFAULT 0"),
            ("duration_min", "INTEGER"),
        ],
        "assets": [
            ("source",      "VARCHAR(32) DEFAULT 'manual'"),
            ("external_id", "VARCHAR(128)"),
        ],
        "transactions": [
            ("source",      "VARCHAR(32) DEFAULT 'manual'"),
            ("external_id", "VARCHAR(128)"),
        ],
    }
```

- [ ] **Step 4: Expose the fields on the output schemas**

In `backend/modules/finance/schemas.py`, add to `class TxnOut` (after its `occurred_at: datetime` line):

```python
    source: str = "manual"
    external_id: str | None = None
```

And add to `class AssetOut` (after its `created_at: datetime` line):

```python
    source: str = "manual"
    external_id: str | None = None
```

- [ ] **Step 5: Add the fields to the TypeScript types**

In `web/lib/api.ts`, update the `Asset` and `Txn` types.

Replace the `Txn` line:

```ts
export type Txn = { id: number; amount: number; category: string; description: string|null; occurred_at: string };
```

with:

```ts
export type Txn = { id: number; amount: number; category: string; description: string|null; occurred_at: string; source: string; external_id: string|null };
```

Replace the `Asset` type's closing so it includes the two fields — change:

```ts
  notes: string | null;
  last_updated: string;
  created_at: string;
};
```

(within the `Asset` type) to:

```ts
  notes: string | null;
  last_updated: string;
  created_at: string;
  source: string;
  external_id: string | null;
};
```

- [ ] **Step 6: Apply the migration**

Stop and restart the backend background process — `init_db()` runs on startup (via the lifespan handler) and applies the additive column migration. The currently-running process must be restarted so its loaded SQLAlchemy models include the new columns for later tasks.

If you cannot restart it immediately, apply the migration to the DB file directly as a fallback:

`.venv\Scripts\python.exe -c "from backend.core.db import init_db; init_db(); print('migrated')"`
Expected: `migrated`

- [ ] **Step 7: Verify the new columns exist**

Run:

`.venv\Scripts\python.exe -c "import sqlite3; c=sqlite3.connect('data/jarvis.db'); print([r[1] for r in c.execute('PRAGMA table_info(assets)')]); print([r[1] for r in c.execute('PRAGMA table_info(transactions)')])"`

Expected: both lists include `source` and `external_id`.

- [ ] **Step 8: Commit**

```bash
git add backend/modules/finance/models.py backend/core/db.py backend/modules/finance/schemas.py web/lib/api.ts
git commit -m "Add source/external_id columns to assets and transactions"
```

---

### Task 3: Pure sync mapping functions (TDD)

**Files:**
- Create: `backend/modules/robinhood/__init__.py`
- Create: `backend/modules/robinhood/sync.py`
- Test: `tests/test_robinhood_sync.py`

> This task creates the module package dir. `__init__.py` will export the router in Task 5; for now it can be empty so `backend.modules.robinhood` is importable.

- [ ] **Step 1: Create an empty package init**

Create `backend/modules/robinhood/__init__.py` with a single comment line:

```python
# robinhood module — router exported in router.py (wired in __init__ at Task 5)
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_robinhood_sync.py`:

```python
from backend.modules.robinhood import sync


def test_position_to_asset_stock():
    pos = {"account_id": "acc1", "ticker": "AAPL", "name": "Apple Inc.",
           "units": 10.0, "price": 150.0, "cost_basis_per_share": 120.0, "is_crypto": False}
    a = sync.position_to_asset(pos)
    assert a["category"] == "stocks"
    assert a["ticker"] == "AAPL"
    assert a["shares"] == 10.0
    assert a["value"] == 1500.0
    assert a["cost_basis"] == 1200.0
    assert a["source"] == "robinhood"
    assert a["external_id"] == "acc1:AAPL"


def test_position_to_asset_crypto_without_cost_basis():
    pos = {"account_id": "acc1", "ticker": "BTC", "name": "Bitcoin",
           "units": 0.5, "price": 60000.0, "cost_basis_per_share": None, "is_crypto": True}
    a = sync.position_to_asset(pos)
    assert a["category"] == "crypto"
    assert a["value"] == 30000.0
    assert a["cost_basis"] is None


def test_cash_to_asset():
    a = sync.cash_to_asset({"account_id": "acc1", "amount": 250.75})
    assert a["category"] == "cash"
    assert a["value"] == 250.75
    assert a["external_id"] == "acc1:CASH"
    assert a["ticker"] is None


def test_activity_buy_forced_negative():
    t = sync.activity_to_transaction({"id": "x1", "type": "BUY", "amount": 1500.0,
                                      "symbol": "AAPL", "description": "Bought 10",
                                      "date": "2026-06-10T14:30:00Z"})
    assert t["amount"] == -1500.0
    assert t["category"] == "buy"
    assert t["external_id"] == "x1"
    assert t["source"] == "robinhood"


def test_activity_dividend_positive():
    t = sync.activity_to_transaction({"id": "d1", "type": "DIVIDEND", "amount": 12.5,
                                      "symbol": "VTI", "description": None,
                                      "date": "2026-06-01T00:00:00Z"})
    assert t["amount"] == 12.5
    assert t["category"] == "dividend"


def test_external_ids_are_stable():
    pos = {"account_id": "acc1", "ticker": "AAPL", "name": "Apple",
           "units": 10.0, "price": 150.0, "cost_basis_per_share": 120.0, "is_crypto": False}
    assert sync.position_to_asset(pos)["external_id"] == sync.position_to_asset(pos)["external_id"]
    act = {"id": "x1", "type": "BUY", "amount": 1500.0, "symbol": "AAPL",
           "description": "d", "date": "2026-06-10T14:30:00Z"}
    assert sync.activity_to_transaction(act)["external_id"] == sync.activity_to_transaction(act)["external_id"]
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_robinhood_sync.py -v`
Expected: FAIL — `ModuleNotFoundError` / `AttributeError: module ... has no attribute 'position_to_asset'`.

- [ ] **Step 4: Implement sync.py**

Create `backend/modules/robinhood/sync.py`:

```python
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_robinhood_sync.py -v`
Expected: `6 passed`.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/robinhood/__init__.py backend/modules/robinhood/sync.py tests/test_robinhood_sync.py
git commit -m "Add pure Robinhood sync mapping functions with tests"
```

---

### Task 4: SnapTrade client wrapper

**Files:**
- Create: `backend/modules/robinhood/client.py`
- Create: `backend/scripts/snaptrade_connect.py`

> The nested-JSON extraction in `_normalize_position` / `_normalize_activity` is based on SnapTrade's documented shapes but is verified and adjusted against real data in Task 8. All public functions degrade via the two custom exceptions, mirroring `garmin/client.py`.

- [ ] **Step 1: Implement the client wrapper**

Create `backend/modules/robinhood/client.py`:

```python
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
```

- [ ] **Step 2: Add the optional CLI connect fallback**

Create `backend/scripts/snaptrade_connect.py`:

```python
"""One-time CLI fallback to connect Robinhood via SnapTrade.

Prefer the in-app 'Connect Robinhood' button. This exists for headless setup.

Run from repo root:
    .\\.venv\\Scripts\\python.exe -m backend.scripts.snaptrade_connect
"""
from backend.modules.robinhood import client as rc


def main() -> None:
    try:
        result = rc.connect()
    except rc.SnapTradeNotConfigured as e:
        print(f"Not configured: {e}")
        return
    url = result.get("redirect_url")
    if not url:
        print("Could not get a connection URL. Check your SnapTrade keys.")
        return
    print("Open this URL, log into Robinhood, and authorize (read-only):\n")
    print(url)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Verify the client imports and degrades without keys**

Run: `.venv\Scripts\python.exe -c "from backend.modules.robinhood import client as c; print(c.status())"`
Expected (no keys set yet): `{'configured': False, 'connected': False, 'reason': '...not set'}`

- [ ] **Step 4: Commit**

```bash
git add backend/modules/robinhood/client.py backend/scripts/snaptrade_connect.py
git commit -m "Add SnapTrade client wrapper and CLI connect fallback"
```

---

### Task 5: Router, DB upsert, and module mount

**Files:**
- Create: `backend/modules/robinhood/router.py`
- Modify: `backend/modules/robinhood/__init__.py`

- [ ] **Step 1: Implement the router with upsert**

Create `backend/modules/robinhood/router.py`:

```python
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
```

- [ ] **Step 2: Export the router from the package init**

Replace the entire contents of `backend/modules/robinhood/__init__.py` with:

```python
from .router import router

__all__ = ["router"]
```

- [ ] **Step 3: Verify the module mounts**

Restart the backend, then run:

`.venv\Scripts\python.exe -c "import json,urllib.request; print(urllib.request.urlopen('http://localhost:8000/api/modules').read().decode())"`

Expected: the JSON list includes `{"name": "robinhood", "prefix": "/api/robinhood"}`.

- [ ] **Step 4: Verify the status endpoint**

Run: `.venv\Scripts\python.exe -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/api/robinhood/status').read().decode())"`
Expected: `{"configured": false, "connected": false, "reason": "...not set"}` (until keys are added).

- [ ] **Step 5: Commit**

```bash
git add backend/modules/robinhood/router.py backend/modules/robinhood/__init__.py
git commit -m "Add Robinhood router with idempotent asset/transaction upsert"
```

---

### Task 6: Inject finance snapshot into chat context

**Files:**
- Modify: `backend/modules/chat/router.py:8-9` (imports), `:38-60` (`_build_context`)

- [ ] **Step 1: Import the finance models**

In `backend/modules/chat/router.py`, after the existing `from backend.modules.goals.models import Goal` line, add:

```python
from backend.modules.finance.models import Asset, Liability, Transaction
```

- [ ] **Step 2: Append a finance section in `_build_context`**

In `_build_context`, immediately before the final `return "\n".join(lines)`, insert:

```python
    # Finance snapshot (includes Robinhood-synced holdings)
    assets = db.query(Asset).order_by(Asset.value.desc()).all()
    liabilities = db.query(Liability).all()
    assets_total = sum(a.value or 0 for a in assets)
    liab_total = sum(l.balance or 0 for l in liabilities)
    cash_total = sum(a.value or 0 for a in assets if a.category == "cash")
    lines += ["", "## Finance"]
    lines.append(
        f"- Net worth: ${assets_total - liab_total:,.0f} "
        f"(assets ${assets_total:,.0f}, debts ${liab_total:,.0f}, cash ${cash_total:,.0f})"
    )
    top = [a for a in assets if a.category in ("stocks", "crypto")][:5]
    if top:
        lines.append("- Top positions:")
        for a in top:
            tk = f" {a.ticker}" if a.ticker else ""
            lines.append(f"  - {a.name}{tk}: ${a.value:,.0f}")
    recent = db.query(Transaction).order_by(Transaction.occurred_at.desc()).limit(3).all()
    if recent:
        lines.append("- Recent transactions:")
        for t in recent:
            sign = "-" if t.amount < 0 else "+"
            lines.append(f"  - {t.occurred_at.date()} {sign}${abs(t.amount):,.0f} {t.category}")
```

- [ ] **Step 3: Verify the briefing endpoint still works**

Restart the backend, then run:

`.venv\Scripts\python.exe -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/api/chat/briefing').read().decode()[:200])"`

Expected: a JSON `{"reply": "...", "provider": "..."}` with no error (stub reply is fine if no LLM key).

- [ ] **Step 4: Commit**

```bash
git add backend/modules/chat/router.py
git commit -m "Surface finance snapshot to chat assistant context"
```

---

### Task 7: Finance-page Robinhood panel

**Files:**
- Modify: `web/lib/api.ts` (append Robinhood types)
- Modify: `web/app/(console)/finance/page.tsx:1-6` (imports), `:40-56` (render), append component

- [ ] **Step 1: Add Robinhood types to api.ts**

Append to `web/lib/api.ts`:

```ts
export type RobinhoodStatus = { configured: boolean; connected: boolean; reason?: string };
export type RobinhoodSyncResult = {
  available: boolean;
  reason?: string;
  assets_synced?: number;
  transactions_synced?: number;
  portfolio_value?: number;
};
```

- [ ] **Step 2: Import the types on the finance page**

In `web/app/(console)/finance/page.tsx`, change the import block:

```tsx
import {
  api, Txn, IncomeSource, Asset, Liability, FinanceOverview,
} from "@/lib/api";
```

to:

```tsx
import {
  api, Txn, IncomeSource, Asset, Liability, FinanceOverview,
  RobinhoodStatus, RobinhoodSyncResult,
} from "@/lib/api";
```

- [ ] **Step 3: Render the panel under the overview**

In the same file, change:

```tsx
      <OverviewBlock overview={overview} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
```

to:

```tsx
      <OverviewBlock overview={overview} />

      <RobinhoodBlock onSynced={refresh} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
```

- [ ] **Step 4: Add the component**

Append to the end of `web/app/(console)/finance/page.tsx`:

```tsx
/* ---------------- Robinhood ---------------- */

function RobinhoodBlock({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<RobinhoodStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadStatus() {
    try { setStatus(await api.get<RobinhoodStatus>("/api/robinhood/status")); }
    catch { setStatus(null); }
  }
  useEffect(() => { loadStatus(); }, []);

  async function connect() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<{ available: boolean; redirect_url?: string; reason?: string }>("/api/robinhood/connect", {});
      if (r.available && r.redirect_url) window.open(r.redirect_url, "_blank");
      else setMsg(r.reason ?? "Could not start connection.");
    } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<RobinhoodSyncResult>("/api/robinhood/sync", {});
      if (r.available) {
        setMsg(`Synced ${r.assets_synced} holdings · ${r.transactions_synced} transactions · ${$(r.portfolio_value ?? 0)} portfolio`);
        onSynced();
      } else {
        setMsg(r.reason ?? "Sync unavailable.");
      }
    } finally { setBusy(false); loadStatus(); }
  }

  const connected = status?.connected;
  const pill = !status?.configured
    ? { t: "NOT CONFIGURED", c: "#6b7c9a" }
    : connected
      ? { t: "CONNECTED", c: "#22e8a0" }
      : { t: "NOT CONNECTED", c: "#ff9c2a" };

  return (
    <Panel title="Robinhood">
      <div className="flex flex-wrap items-center gap-3">
        <span className="pill" style={{ borderColor: pill.c, color: pill.c }}>
          <span className="dot" style={{ background: pill.c, width: 7, height: 7 }} /> {pill.t}
        </span>
        {!connected && (
          <button className="btn" disabled={busy || !status?.configured} onClick={connect}>
            CONNECT ROBINHOOD
          </button>
        )}
        <button className="btn" disabled={busy || !connected} onClick={syncNow}>SYNC NOW</button>
        {msg && <span className="text-xs text-jarvis-muted">{msg}</span>}
      </div>
      {!status?.configured && (
        <div className="text-xs text-jarvis-muted mt-2">
          Add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY to backend/.env, then restart the backend.
        </div>
      )}
    </Panel>
  );
}
```

- [ ] **Step 5: Verify the page compiles and renders**

The Next.js dev server hot-reloads. Run:

`.venv\Scripts\python.exe -c "import urllib.request; print('finance' in urllib.request.urlopen('http://localhost:3000/finance').read().decode().lower())"`

Expected: `True` (page returns HTTP 200 and renders). Then visually confirm the **Robinhood** panel shows a `NOT CONFIGURED` pill at http://localhost:3000/finance.

- [ ] **Step 6: Commit**

```bash
git add web/lib/api.ts "web/app/(console)/finance/page.tsx"
git commit -m "Add Robinhood connect/sync panel to Finance page"
```

---

### Task 8: End-to-end manual verification (real account)

**Files:** none (verification only).

> This is the only task that needs real SnapTrade keys + a Robinhood login. It also confirms the SnapTrade JSON shapes assumed in `_normalize_position` / `_normalize_activity` and the crypto caveat from the spec.

- [ ] **Step 1: Add real SnapTrade keys**

Put your `SNAPTRADE_CLIENT_ID` and `SNAPTRADE_CONSUMER_KEY` in `backend/.env`, then restart the backend.

- [ ] **Step 2: Confirm status flips to configured**

Visit http://localhost:8000/api/robinhood/status → expect `{"configured": true, "connected": false, ...}`.

- [ ] **Step 3: Connect Robinhood**

On http://localhost:3000/finance, click **CONNECT ROBINHOOD**. Authorize Robinhood (read-only) in the opened tab. Return and confirm the pill shows **CONNECTED** (re-check status if needed).

- [ ] **Step 4: Sync and verify**

Click **SYNC NOW**. Confirm the success message shows non-zero holdings and a portfolio value. Verify in the **Assets** list that Robinhood positions appear (stocks + cash; crypto if your account holds it and SnapTrade exposes it). Confirm net worth on the **Net Worth** card increased accordingly.

- [ ] **Step 5: Confirm idempotency**

Click **SYNC NOW** again. Confirm the assets list does **not** duplicate rows (counts stay stable) and any manually-added assets/transactions are untouched.

- [ ] **Step 6: Adjust normalization if needed**

If tickers, values, crypto flags, or transactions look wrong, inspect a raw payload:

`.venv\Scripts\python.exe -c "from backend.modules.robinhood import client as c; import json; print(json.dumps(c.fetch_normalized(), default=str)[:2000])"`

Fix the field paths in `_normalize_position` / `_normalize_activity`, re-sync, and commit the fix:

```bash
git add backend/modules/robinhood/client.py
git commit -m "Adjust SnapTrade payload normalization to real Robinhood data"
```

- [ ] **Step 7: Verify chat sees the portfolio**

On http://localhost:3000/chat, ask "What's in my portfolio?" Confirm the assistant references your synced holdings/net worth (requires an LLM key; with the stub provider, instead confirm the context by checking `/api/chat/briefing` returns without error).
