# Robinhood Integration via SnapTrade — Design Spec

**Date:** 2026-06-13
**Status:** Draft for review
**Author:** Mason + JARVIS

## Goal

Let JARVIS pull the user's Robinhood account data into the Finance module so it
contributes to net worth, shows per-position detail, and is readable by the
JARVIS chat assistant. Robinhood has no official public API, so the connection
is made through **SnapTrade**, an official brokerage-aggregation API that
supports Robinhood via a secure OAuth-style portal (the user logs in on
Robinhood's own page; JARVIS never sees the Robinhood password).

## Scope

In scope (all four selected by the user):
- **Portfolio value → net worth** — cash balance synced as an Asset.
- **Individual positions** — each stock holding synced as its own Asset.
- **Crypto holdings** — crypto positions synced as Assets (`category=crypto`).
- **Transaction history** — orders/activities imported as Transactions.
- **AI readability** — synced data surfaced to the chat assistant via the
  existing system-prompt context-injection path.

Out of scope (explicitly deferred):
- Trading/order placement through SnapTrade.
- In-process LLM tool-use or a standalone MCP server for on-demand querying.
  These are additive layers on top of the same SDK + DB foundation and can be
  added later without reworking the integration.
- Multi-brokerage support. The module is named `robinhood`; SnapTrade could
  connect others later, but YAGNI for now.

## Approach

Use the maintained **`snaptrade-python-sdk`** directly inside the FastAPI
backend, mirroring the existing Garmin integration (which imports
`garminconnect` directly). This keeps the codebase consistent: one client
wrapper, in-process, graceful degradation, no extra services to run.

Rejected alternatives:
- **CLI** — SnapTrade ships no official CLI; wrapping the SDK in a CLI is
  strictly worse than calling the SDK.
- **MCP server now** — wrong layer for scheduled sync; valuable only for
  *external* access (e.g. Claude Desktop). Deferred.
- **robin_stocks / Plaid / manual CSV** — rejected during brainstorming in
  favor of SnapTrade (legitimate, read-only, no stored Robinhood password).

## Architecture

New auto-mounted module following the Garmin pattern. The module registry
(`backend/core/registry.py`) mounts any `modules/<name>/` package that exposes
a `router`, so this mounts at `/api/robinhood`.

```
backend/modules/robinhood/
  __init__.py   # exposes `router`
  client.py     # wraps snaptrade-python-sdk: auth, 60s cache, custom exceptions
  sync.py       # PURE mapping: SnapTrade payloads -> Asset/Transaction dicts
  router.py     # /api/robinhood/* endpoints
backend/scripts/snaptrade_connect.py   # optional CLI fallback for connecting
tests/test_robinhood_sync.py           # unit tests for sync.py (repo's first test)
```

### client.py

Mirrors `garmin/client.py`. Responsibilities:
- Read `SNAPTRADE_CLIENT_ID` / `SNAPTRADE_CONSUMER_KEY` from settings.
- Persist the per-user `userId` + `userSecret` (minted at registration) to
  `data/snaptrade/creds.json` (gitignored). These are read-only access
  credentials, **not** the Robinhood password.
- Custom exceptions `SnapTradeNotConfigured` (no API keys) and
  `SnapTradeNotConnected` (no saved user/connection), used for graceful
  degradation.
- Thin wrapper methods: `register_user()`, `connection_portal_url()`,
  `list_accounts()`, `balances()`, `positions()`, `orders()`.
- 60-second response cache (`_CACHE_TTL`), same as Garmin, to avoid hammering
  SnapTrade.
- `status()` returning `{configured, connected, reason?}`.

### sync.py (pure, testable — the risky logic)

No network, no DB session — pure functions transforming SnapTrade payloads into
row dicts. This is where mapping/dedupe correctness is verified by tests because
it writes directly to net-worth numbers.

- `positions_to_assets(accounts, positions) -> list[dict]` — maps each equity
  position to an Asset dict (`category` `stocks`/`crypto`, `ticker`, `shares`,
  `value`, `cost_basis`, `source="robinhood"`, `external_id`).
- `balances_to_cash_assets(balances) -> list[dict]` — maps cash balance to a
  `cash` Asset.
- `orders_to_transactions(orders) -> list[dict]` — maps filled orders/dividends
  to Transaction dicts (`amount` signed, `category`, `description`,
  `occurred_at`, `source="robinhood"`, `external_id`).
- `external_id` is deterministic (account id + symbol for assets; SnapTrade
  order/activity id for transactions) so re-syncs upsert in place.

### router.py — endpoints

- `GET  /api/robinhood/status` — `{configured, connected, reason?}` (like
  `/api/garmin/status`).
- `POST /api/robinhood/connect` — registers the SnapTrade user if needed, saves
  creds, returns `{redirect_url}` for the connection portal.
- `POST /api/robinhood/sync` — pulls balances + positions + orders, upserts into
  `assets` and `transactions`, returns counts
  `{assets_synced, transactions_synced, portfolio_value}`.
- All endpoints degrade to `{available: false, reason: ...}` when not
  configured/connected — they never 500 on missing setup.

## Data model changes

Add two columns to **both** `assets` and `transactions` tables, applied through
the existing `_apply_lightweight_migrations()` mechanism in `backend/core/db.py`
(additive `ALTER TABLE ... ADD COLUMN`, no data loss):

| Column        | Type             | Default      | Purpose                                  |
|---------------|------------------|--------------|------------------------------------------|
| `source`      | `VARCHAR(32)`    | `'manual'`   | Distinguishes synced rows from manual.   |
| `external_id` | `VARCHAR(128)`   | `NULL`       | Stable key for idempotent upsert/dedupe. |

The matching SQLAlchemy columns are added to `Asset` and `Transaction` in
`finance/models.py`, and to the `*Out` schemas in `finance/schemas.py` (and the
TS types in `web/lib/api.ts`).

### Upsert rule

On sync, for each mapped row: look up existing row by
`(source="robinhood", external_id)`. If found, update value/shares/etc. in
place; else insert. **Rows with `source="manual"` are never touched**, so the
user's hand-entered assets and transactions are safe.

## AI readability

Extend `_build_context()` in `backend/modules/chat/router.py` (which already
injects open tasks and goals into the system prompt) with a compact finance
summary: net worth, cash, the top 5 positions by value, and the 3 most recent
transactions. This makes the chat assistant aware of the Robinhood portfolio
with ~10–15 lines and no new architecture. On-demand tool-use/MCP remains a
future option on the same data.

## Frontend

On the **Finance** page (`web/app/(console)/finance/page.tsx`):
- A status pill: `CONNECTED` / `NOT CONNECTED` driven by `/api/robinhood/status`.
- A **Connect Robinhood** button → calls `POST /connect`, opens the returned
  portal URL in a new tab.
- A **Sync now** button → calls `POST /sync`, then refreshes the assets list.
- Synced holdings appear in the existing assets list (a small `ROBINHOOD` source
  tag distinguishes them from manual entries).

## Configuration & secrets

Add to `backend/.env.example`:

```
SNAPTRADE_CLIENT_ID=
SNAPTRADE_CONSUMER_KEY=
```

- The user signs up for free SnapTrade developer keys and pastes them in.
- The minted `userId`/`userSecret` live in `data/snaptrade/creds.json`, which is
  gitignored (the `data/` dir already is).
- No secret values are ever logged or echoed. `data/snaptrade/` is added to
  `.gitignore` defensively.

Add `snaptrade-python-sdk` and `pytest` (test-only) to `backend/requirements.txt`.

## Testing

`tests/test_robinhood_sync.py` (pytest) covers `sync.py` pure functions against
representative SnapTrade payload fixtures:
- position → Asset mapping (stocks and crypto, cost basis, ticker).
- balance → cash Asset mapping.
- order → Transaction sign/category mapping.
- idempotency: same payload twice yields stable `external_id`s (no duplicates).

This is the repo's first test; `pytest` added to requirements. No network calls
in tests — SnapTrade responses are fixtures.

## Error handling & edge cases

- Missing API keys → `status.configured=false`; connect/sync return
  `{available:false}`.
- User registered but no brokerage linked yet → `connected=false`; sync is a
  no-op with a clear reason.
- SnapTrade rejects the saved `userSecret` (revoked) → surface a re-connect
  reason, same shape as Garmin's token-rejected path.
- Empty portfolio → sync succeeds with zero counts.
- **Crypto availability assumption** → crypto sync depends on SnapTrade exposing
  Robinhood crypto positions through the positions endpoint. If SnapTrade does
  not return them for Robinhood, stock + cash + transactions still sync and
  crypto simply yields zero rows (no error). To be confirmed during step 8.
- SnapTrade outage → caught, returns `{available:false, reason}`; existing
  finance data still renders.

## Build sequence

1. Add dependency + config keys + `.gitignore` entry.
2. Data-model columns + lightweight migration.
3. `sync.py` pure functions + tests (TDD).
4. `client.py` SnapTrade wrapper.
5. `router.py` endpoints + module registration.
6. Chat context-injection.
7. Finance-page UI (status pill, Connect, Sync now).
8. Manual end-to-end connect + sync against a real Robinhood account.

---

## Addendum (2026-06-13): Personal OAuth pivot — IMPLEMENTED

The original design assumed partner/commercial SnapTrade keys (signature auth +
`registerSnapTradeUser` + `{userId, userSecret}`). The account in use has
**Personal** keys, which reject `registerUser` (HTTP 400, code 1012:
"Personal SnapTrade keys are provisioned with their user automatically at signup.
Use the OAuth bearer flow"). The auth layer was re-architected accordingly.

**New auth model — OAuth2 + PKCE bearer (read-only):**
- One-time browser sign-in: `connect()` builds an authorize URL
  (`authorization_endpoint` from discovery, public PKCE `client_id`,
  `redirect_uri=http://127.0.0.1:<port>/oauth/callback`, `scope=read`, S256
  challenge) and starts a one-shot loopback listener.
- SnapTrade redirects to the loopback with `code`; we exchange it for an
  `access_token` + `refresh_token` and store them at
  `data/snaptrade/oauth_tokens.json` (gitignored; never logged or returned).
- Data calls are raw `httpx` GETs to `https://api.snaptrade.com/api/v1/...` with
  `Authorization: Bearer <token>`. The Personal user is implied by the token —
  no `userId`/`userSecret`. (The Python SDK only speaks signature auth, so it is
  not used for data.)

**Automatic polling (the key requirement):** the stored `refresh_token` lets the
backend mint fresh access tokens with no further user interaction. A background
scheduler (`scheduler.py`, started in the app lifespan) syncs every
`SNAPTRADE_SYNC_INTERVAL_MIN` minutes (default 60), runs only when tokens exist,
and logs-and-continues on error. After the one-time sign-in, sync is unattended.

**Unchanged from the original design:** `sync.py` pure mappings (+ tests), the
idempotent upsert keyed on `(source, external_id)`, the `source`/`external_id`
columns, the chat context injection, and the Finance-page UI shape. The upsert
moved into `service.py` so the scheduler and the `/sync` endpoint share it.

**New files:** `oauth.py`, `service.py`, `scheduler.py`.
**New config:** `snaptrade_oauth_client_id`, `snaptrade_redirect_port`,
`snaptrade_sync_interval_min`.
