# Research: Automatic Robinhood sync with SnapTrade **Personal** keys

**Date:** 2026-06-13
**Why:** The user only has SnapTrade *Personal* keys (no developer/commercial API in their dashboard). Personal keys reject `registerUser` (error 1012) and require an **OAuth bearer** flow, which the current integration (signature auth + registerUser) does not implement. Goal: find the best way to sync Robinhood data **automatically/periodically**.

## The Personal OAuth flow (from SnapTrade's official CLI: `passiv/snaptrade-cli`, `docs/personal-oauth-integration.md`)

1. **Discovery** — `GET https://api.snaptrade.com/.well-known/oauth-authorization-server` → returns `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`.
2. **Authorize (OAuth2 + PKCE)** — build the authorize URL with:
   - `response_type=code`
   - `client_id=lBHki0jPb0OJOca1cTlkHjuWsAGC8m6o2xOib0nN`  (SnapTrade's public OAuth client id used by the CLI / personal flow)
   - `redirect_uri` = loopback, e.g. `http://127.0.0.1:<port>/oauth/callback`
   - `scope=read`  (read covers account data + connection management; not trading — perfect for our read-only sync)
   - `state` (random), `code_challenge` (S256 of a random `code_verifier`), `code_challenge_method=S256`
   - User opens this in a browser, signs into SnapTrade, authorizes.
3. **Callback + token exchange** — a local loopback listener captures `code`, verifies `state`, then POSTs to `token_endpoint` (`application/x-www-form-urlencoded`):
   `grant_type=authorization_code, code, code_verifier, redirect_uri, client_id` → returns `access_token`, `refresh_token`, expiry.
4. **Refresh** — before calls, if the access token is near expiry (60s skew), POST `grant_type=refresh_token, refresh_token, client_id` to `token_endpoint`.
5. **API calls** — the access token is sent as `Authorization: Bearer <access_token>`; **the Personal user is inferred from the token** (no userId/userSecret). Normal account/positions/balances/activities endpoints are then called.
6. **Revoke (sign out)** — POST `token, token_type_hint=refresh_token, client_id` to `revocation_endpoint`.

In the **JS/TS SDK** this is `new Snaptrade({ auth: SnaptradeAuth.personalOAuth({ accessToken: async () => <fresh token> }) })`.

## Why this enables fully automatic polling
Once a `refresh_token` is stored from the one-time browser sign-in, the backend can **refresh the access token and sync on a schedule with no further user interaction**. So the architecture is:

> one-time browser OAuth sign-in → store `refresh_token` → background scheduler refreshes the access token + runs sync every N minutes, unattended.

If the refresh token ever expires/revokes, the user re-authorizes once via the browser.

## Critical constraint for our Python stack
- `SnaptradeAuth.personalOAuth({accessToken})` is the **JavaScript SDK** API. The **Python SDK** (`snaptrade-python-sdk`) is built around **signature auth** (PartnerSignature/consumerKey) — the public partner `api.yaml` documents only signature auth, no bearer. So the Python SDK **likely cannot do bearer/personalOAuth**.
- **Implication:** implement the OAuth dance ourselves in Python and make the data calls as **raw HTTPS GETs with `Authorization: Bearer <token>`** to `https://api.snaptrade.com/api/v1/...`, instead of via the Python SDK. Our existing `sync.py` mapping + upsert + UI are unaffected — only the transport/auth layer changes.

## Recommended implementation (replaces the registerUser-based connect)
1. **`backend/modules/robinhood/oauth.py`** — discovery, PKCE, a short-lived loopback callback server, token exchange, refresh, and token storage to `data/snaptrade/oauth_tokens.json` (gitignored). Uses the public `client_id` above.
2. **Rework `client.py`** — `connect()` runs the OAuth sign-in (opens browser, captures callback, stores tokens); data fetch uses a `_bearer()` helper that returns a fresh access token (auto-refresh) and raw `httpx` GETs for accounts/positions/balances/activities. Keep `fetch_normalized()`'s output shape identical so `sync.py`/router/UI are untouched.
3. **Background scheduler** — APScheduler `AsyncIOScheduler` (or an asyncio task in the FastAPI lifespan) that calls the sync routine every `SNAPTRADE_SYNC_INTERVAL_MIN` (default 60) when tokens exist; logs-and-continues on error. This is the "automatic" piece.

## Open items to verify EARLY in implementation (don't assume)
- **Exact bearer-authenticated data endpoints + base host.** Confirm `https://api.snaptrade.com/api/v1/accounts` (and `/accounts/{id}/positions|balances|activities`) accept `Authorization: Bearer` for personal users (vs. a different host/path). Pull these from the discovery doc + `api.yaml`.
- **Whether the Python SDK can accept a bearer token / custom Authorization header** (if yes, we could reuse its response models instead of raw HTTP). Default assumption: no → raw `httpx`.
- **Loopback redirect** works because JARVIS runs locally (127.0.0.1) — good fit. Confirm the SnapTrade OAuth client allows a loopback redirect_uri (the CLI uses exactly this).

## Effort / impact
- This is a **re-architecture of the auth layer**, not a tweak. Reusable as-is: `sync.py` (+tests), the upsert logic in `router.py`, the `source/external_id` columns, the Finance-page UI, the chat context injection.
- Needs updating: the design spec + plan (auth section), `client.py` (rewrite), new `oauth.py`, new scheduler, config (`SNAPTRADE_SYNC_INTERVAL_MIN`), requirements (`httpx` already present; maybe `apscheduler`).

## Sources
- SnapTrade CLI personal-oauth integration doc — github.com/passiv/snaptrade-cli (`docs/personal-oauth-integration.md`, `src/utils/oauthConstants.cjs`)
- SnapTrade API spec — github.com/passiv/snaptrade-api-docs (`docs/api.yaml`): partner API is signature-auth only
- docs.snaptrade.com — Personal vs Commercial, Connections, Client-side Direct API Usage
