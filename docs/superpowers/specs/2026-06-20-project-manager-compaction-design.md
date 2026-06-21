# Phase 2b — Manager Rollup & Auto-Compaction — Design

**Date:** 2026-06-20
**Status:** Approved for planning
**Builds on:** Phase 1 (resumable agent core), Phase 2a (per-project workspaces + Notion doc log)

## Goal

Give the main (General) JARVIS cross-project awareness so it can answer "what's
happening across my projects?" / "where am I on X?" instantly, and keep
long-running per-project chat threads healthy by auto-summarizing them when they
grow large. The two features share one piece of machinery: **a compaction
summary is also a project's manager-facing status.**

## Decisions (locked)

- **Manager source:** a local per-project `status_summary` (fast, cheap, always
  available — no per-question Notion/agent call).
- **Auto-compaction trigger:** estimated tokens, default threshold **50k tokens**
  (`chars / 4` heuristic over the thread's messages), configurable.
- **Surfaces:** General chat context **and** the dashboard Projects panel.

Context windows are 1M on all tiers, so compaction is about **cost/latency**
(every turn re-sends the thread to the paid fast/smart tiers), not overflow. The
agent tier keeps deep context via its own `--resume` session regardless, so
compacting the chat thread is safe.

## Data model

Add two columns to `Project` (`backend/modules/projects/models.py`):

- `status_summary: Mapped[str | None]` — short rollup text (default `None`).
- `last_active_at: Mapped[datetime | None]` — last time this project's thread saw
  a turn (default `None`).

Additive migrations in `backend/core/db.py` (same pattern as the existing
`repo_path` / `project_id` migrations): `ALTER TABLE projects ADD COLUMN
status_summary`, `... ADD COLUMN last_active_at`.

No new tables. The per-project running summary already lives in
`ChatState.compaction_summary`; `status_summary` is the *manager-facing* copy
(for project_id != 0), written at the same moment compaction happens.

## Components

### 1. Token estimator + auto-compaction (`backend/modules/chat/`)

- `store.estimate_tokens(db, project_id) -> int` — sum `len(content)` across the
  thread (turns + existing compaction summary), divide by 4. Pure/ testable.
- New config: `settings.compact_token_threshold: int = 50_000`
  (`backend/core/config.py`).
- New helper `store.maybe_autocompact(db, project_id, summarize)` —
  if `estimate_tokens(...) >= settings.compact_token_threshold`, call
  `summarize(thread_messages)` , then `store.compact(db, summary, project_id)`,
  and — for `project_id != 0` — write the summary to `Project.status_summary`.
  Returns `True` if it compacted. `summarize` is injected (the router passes
  `_summarize`) so it stays unit-testable without an LLM.
- Called in `/stream` **after** the assistant turn is persisted, so the current
  turn always completes and the *next* turn starts compacted. Failures in
  auto-compaction must never break the stream (wrap, log, continue).

### 2. `last_active_at` bump + manual `/compact` writes status

- In `/stream`, after persisting the assistant turn for a real project
  (`project_id != 0`), set `Project.last_active_at = datetime.utcnow()`.
- The existing `POST /compact` handler also writes `Project.status_summary` for a
  real project (so a manual compact refreshes the rollup too). Factor the
  "compact + write status" logic into the shared `store` helper so manual and
  auto paths behave identically.

### 3. Manager context for General chat (`_build_context`)

Add a `## Projects` section to `_build_context(db)` in
`backend/modules/chat/router.py`, listing each non-archived project:

```
## Projects
- Demo (active) — last active 2026-06-19
  <status_summary, or latest assistant-turn snippet if no summary yet>
```

Falls back to the latest assistant turn's first ~200 chars when
`status_summary` is empty (a project that hasn't compacted yet). This section
flows into every tier's `extra_context`, so General JARVIS answers manager
questions from the local rollup with no extra calls. Keep it compact (cap at,
say, the 12 most-recently-active projects) to bound prompt size.

### 4. Dashboard surface

- Extend the projects API response (`backend/modules/projects/router.py`
  `ProjectOut`) with `status_summary` and `last_active_at`.
- Mirror on the frontend `Project` type (`web/lib/api.ts`).
- Show `status_summary` as a small dimmed line under each project in the
  existing dashboard Projects panel (`web/components/.../Projects*`). No new
  widget — enhance what's there. Truncate to one or two lines.

## Data flow

```
turn in project P (/stream)
  └─ persist user turn
  └─ plan + (reply | action | agent)
  └─ persist assistant turn
  └─ P.last_active_at = now            (real projects only)
  └─ maybe_autocompact(P):
        estimate_tokens >= 50k ?
          └─ summary = _summarize(thread)
          └─ store.compact(summary)    (clears turns, sets ChatState.compaction_summary)
          └─ P.status_summary = summary (real projects only)

General chat (project_id 0)
  └─ _build_context() includes "## Projects" rollup from each P.status_summary
  └─ JARVIS answers "what's happening across my projects?" from local context

Dashboard
  └─ GET /api/projects returns status_summary + last_active_at
  └─ Projects panel shows each project's latest status line
```

## Error handling

- Auto-compaction is best-effort: any exception (LLM error, etc.) is caught and
  logged; the turn's response is already sent, so the user sees no failure. The
  thread simply isn't compacted this turn and will be retried next turn.
- `estimate_tokens` and `maybe_autocompact` are pure of HTTP concerns and safe to
  call with an empty thread (returns 0 / does nothing).
- General (`project_id == 0`) has no `Project` row — auto-compaction still runs
  (updates `ChatState.compaction_summary`) but writes no `status_summary`.

## Testing

- `estimate_tokens`: empty thread → 0; known content → expected `chars/4`.
- `maybe_autocompact`: below threshold → no-op, returns False, turns intact;
  at/above threshold → calls injected summarizer, clears turns, sets
  `ChatState.compaction_summary`, and (real project) `Project.status_summary`.
- `/stream` integration: a long thread for a project triggers auto-compaction
  after the turn and writes `status_summary` + `last_active_at` (inject a fake
  `_summarize` / stub the estimate so no LLM runs); a short thread does not.
- `_build_context` includes a `## Projects` section with a project's
  `status_summary`, and falls back to a turn snippet when summary is empty.
- Projects API: `ProjectOut` serializes `status_summary` + `last_active_at`.

## Out of scope

- Reading Notion live for the manager view (we use the local summary; the Notion
  page remains the detailed log the agent maintains).
- Scheduled/background summarization independent of a chat turn.
- Archiving/cleanup of old projects from the rollup (just cap the list length).
