# Design: Automatic Garmin → FIT → JARVIS Fitness Sync

**Date:** 2026-06-13
**Status:** PARTIALLY SUPERSEDED — see note below.
**Scope:** Fitness surface only — `backend/modules/fitness/`, `backend/modules/garmin/`, `web/app/(console)/fitness/`, `tests/`. Shared files touched: `backend/requirements.txt` (additive only).

> **PIVOT (2026-06-13):** The login-based acquisition described below was abandoned at verification time — the unofficial Garmin SSO login returns HTTP 429 (rate-limited) reliably for this account, and the official API is business-only. Acquisition was replaced with **local file-based import** (no login): a watched inbox folder, auto-scan of a connected Garmin USB device's `GARMIN/ACTIVITY` folder, and a drag-and-drop upload in the Fitness tab. The FIT parser, DB models, storage, `/activities` endpoints, and UI history all carried over unchanged. Daily **wellness was deferred** (its only source was the blocked login). The acquisition module is `backend/modules/fitness/ingest.py` (replaces `sync.py`). De-dup is by `sha256` of the `.FIT` bytes (`fit_hash`), since FIT files carry no Garmin activityId.

## Problem

JARVIS should display the user's real Garmin fitness data — activities and daily
wellness — and keep it current **automatically**, without manual file exports or
manual uploads.

### Constraints that shaped the design

- **Garmin's official Connect Developer Program is business-only.** Not available
  for a personal single-user project. Ruled out.
- **The official FIT SDK is a parser, not a fetcher.** It decodes `.FIT` files you
  already have; it cannot pull anything from a Garmin account.
- **Automatic + personal-account ⇒ the acquisition step must use the unofficial
  `garminconnect` library.** This is the only mechanism that can programmatically
  pull a personal account's data on a schedule. It is ToS-gray and can break if
  Garmin changes internals. Accepted trade-off.
- Both libraries (`garminconnect`, `garmin-fit-sdk`) are pure-Python and run in the
  existing FastAPI backend.

## Approach: Hybrid (unofficial acquisition + official parsing)

```
Watch → Garmin Connect cloud
          │
          ▼  [scheduled background job, every 10 min]
   unofficial garminconnect client  ──► downloads NEW activities as original .FIT (zip)
          │                          ──► pulls daily wellness JSON (steps/sleep/BB/stress)
          ▼
   official garmin-fit-sdk  ──► decodes .FIT → normalized activity (summary + samples)
          │
          ▼
   SQLite (fitness module tables)  ◄── de-duped upsert
          │
          ▼
   /api/fitness/*  ──►  Fitness tab (history + "last synced" + Sync-now)
```

Clean separation of concerns:

- **Unofficial library = acquisition only** (download bytes, list activities, pull
  wellness JSON).
- **Official FIT SDK = parsing only** (decode `.FIT` bytes → structured data).

If the acquisition method ever changes (business API access, manual export, watched
folder), the parser / storage / API / UI layers are unchanged.

## Components

All within the fitness surface unless noted.

| File | New/Edit | Purpose |
|---|---|---|
| `backend/modules/fitness/fit_parser.py` | new | Wraps `garmin_fit_sdk`. `parse_activity(fit_bytes) -> dict`. Extracts session summary + downsampled per-second samples. Pure function, no I/O, no network. |
| `backend/modules/fitness/sync.py` | new | Uses `garmin.client`. `sync_activities()` and `sync_wellness()`. Downloads, parses, de-dupes, upserts. `run_sync()` orchestrates both and updates `SyncState`. |
| `backend/modules/fitness/scheduler.py` | new | Daemon thread started once on module import. Loops every `FITNESS_SYNC_INTERVAL_MIN`. Dormant until a Garmin token exists. Guarded so it starts exactly once. |
| `backend/modules/fitness/models.py` | new | SQLAlchemy models. Self-creates tables via `Base.metadata.create_all(bind=engine)` at import. |
| `backend/modules/fitness/__init__.py` | edit | Router: existing `/today` + new endpoints. Imports models/sync/scheduler so they initialize on mount. |
| `backend/modules/garmin/client.py` | edit (additive) | Add `download_activity_original(activity_id) -> bytes` (ORIGINAL format) and `list_activities(start, limit)` passthrough if not already covered by `recent_activities`. |
| `web/app/(console)/fitness/page.tsx` | edit | Activity history list, wellness strip, "last synced Xm ago" indicator + **Sync now** button, one-time-login hint when unauthenticated. |
| `tests/test_fit_parser.py` | new | Parser tested against a sample `.FIT` fixture. |
| `tests/test_fitness_sync.py` | new | De-dup + upsert logic tested with a fake/mocked client. |
| `backend/requirements.txt` | edit (shared) | Append `garmin-fit-sdk`. Only shared-file change; diff flagged before applying. |

## Data model (SQLite, owned by the fitness module)

### `FitActivity`
- `id` (PK)
- `garmin_activity_id` (unique — de-dup key)
- `sport`, `sub_sport`
- `start_time` (UTC)
- `duration_s`
- `distance_m`
- `avg_hr`, `max_hr`
- `avg_speed`
- `calories`
- `total_ascent`
- `samples` (JSON — downsampled per-second points: t, hr, speed, lat, lon, alt, cadence)
- `source` (e.g. `"garmin_fit"`)
- `created_at`

### `WellnessDay`
- `id` (PK)
- `date` (unique — de-dup key)
- `steps`, `step_goal`
- `resting_hr`
- `sleep_seconds`, `sleep_score`
- `body_battery`
- `stress_avg`
- `source`
- `updated_at`

### `SyncState` (singleton row)
- `id` (PK, fixed = 1)
- `last_sync_at`
- `last_status` (`ok` | `error` | `needs_login` | `never`)
- `last_error` (text, nullable)
- `items_synced` (count from last run)

Persisting `SyncState` to the DB lets the UI show "last synced" across backend
restarts.

## API (extends `/api/fitness`)

| Method/Path | Returns |
|---|---|
| `GET /api/fitness/activities?limit=&offset=` | Paginated list of stored activities (summary fields, no samples). |
| `GET /api/fitness/activities/{id}` | One activity incl. `samples` for charting. |
| `GET /api/fitness/wellness?days=` | Recent `WellnessDay` rows. |
| `GET /api/fitness/today` | **Kept.** Reads stored wellness for today; falls back to demo placeholder if none. |
| `GET /api/fitness/sync/status` | `{ authenticated, last_sync_at, last_status, last_error, interval_min, items_synced }`. |
| `POST /api/fitness/sync/now` | Triggers an immediate sync; returns the resulting `SyncState`. |

All endpoints degrade gracefully (return `available:false` / demo / empty) when
Garmin is not authenticated — never 500 the dashboard.

## Scheduler behavior

- Daemon thread, `daemon=True`, started exactly once on first import of the fitness
  module (module-level guard + lock).
- Loop: check auth → if no token, set `SyncState.last_status = "needs_login"` and
  sleep; if token present, `run_sync()`, record status, sleep `interval_min`.
- Interval default **10 min**, via `FITNESS_SYNC_INTERVAL_MIN`.
- `FITNESS_SYNC_ENABLED` (default true) can disable the thread entirely.
- `FITNESS_ACTIVITY_BACKFILL` (default 20) caps how many recent activities are
  checked per run.

## Configuration (no shared `config.py` edit)

Sync settings are read with `os.getenv` inside the fitness module, with defaults, to
avoid editing the shared `backend/core/config.py`:

- `FITNESS_SYNC_ENABLED` (default `"true"`)
- `FITNESS_SYNC_INTERVAL_MIN` (default `10`)
- `FITNESS_ACTIVITY_BACKFILL` (default `20`)

These can be folded into the central `Settings` object later if desired.

## Error handling

- **No cached token** → scheduler dormant; `/sync/status` reports `needs_login`; UI
  shows the one-time `garmin_login` instruction. No crashes.
- **Per-activity download/parse failure** → caught, recorded in `SyncState.last_error`,
  skip that activity, continue the run. Idempotent + de-duped, so retries are safe.
- **Rate limiting** → small backfill window (20), 10-min interval, reuse the existing
  60s client cache for wellness reads.
- **ORIGINAL download format** → returned as a `.zip` containing the `.FIT`; the sync
  layer handles both zipped and raw `.fit` bytes before handing to the parser.

## The one manual step (once)

User runs `python -m backend.scripts.garmin_login` a single time to cache an auth
token under `data/garmin_token/`. After that, sync is fully automatic. This is
unavoidable for any personal-account pull.

## Testing approach (TDD)

1. **`fit_parser`** — decode a real sample `.FIT` fixture; assert extracted summary
   fields and that samples are downsampled and well-formed.
2. **`sync`** — with a fake client returning canned activity lists + `.FIT` bytes,
   assert: new activities inserted, duplicates skipped, wellness upserted by date,
   `SyncState` updated, per-item failure does not abort the run.
3. **Endpoints** — stored data is returned; unauthenticated state degrades gracefully.

## Scope discipline (coordination with the other agent)

- **Not touched:** `backend/core/config.py`, `backend/main.py`, `backend/core/db.py`
  (only `Base`/`engine` are imported, never edited).
- **Only shared file edited:** `backend/requirements.txt` — a single-line append,
  diff shown before applying.
- Everything else lives in `backend/modules/fitness/`, `backend/modules/garmin/`,
  `web/app/(console)/fitness/`, and `tests/`.

## Out of scope (YAGNI)

- Official Garmin business API integration.
- Manual `.FIT` upload UI and watched-folder import (both viable later; not built now).
- Editing/deleting activities, goals, or training-plan features.
- Any change to non-fitness modules or shared dashboard layout.
