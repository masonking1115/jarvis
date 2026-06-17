# JARVIS Awareness & Learning — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorm) — pending implementation plan

## Goal

Give JARVIS a persistent, growing model of the user. He should slowly learn what
the user is like, what they want to do, and how to help make it happen — then
ground every response (typed, voice, and the action planner) in that knowledge
and act on it proactively.

## Problem

Today JARVIS has **no memory**. His only knowledge of the user is:

1. The hand-written `backend/jarvis_profile.md` persona file, and
2. Live data pulled from modules (tasks, goals, finance) and injected into the
   **chat** prompt by `chat/router.py::_build_context`.

Nothing accumulates. He forgets everything between sessions, and the **action
planner** (`agent/service.py::plan`) is entirely blind — it sees only the persona
and the last 8 chat turns, none of the user's data or history. This is why he
feels generic and why he can't reason about "me."

## Decisions (locked during brainstorming)

- **Learning mode:** hybrid — auto-extract from conversations **and** save what
  the user explicitly asks him to remember.
- **Proactivity:** proactive **and** action-initiating — he grounds answers in
  what he knows, volunteers relevant connections, and may initiate actions toward
  the user's goals (confirming anything irreversible, per existing guardrails).
- **Oversight:** silent learning (a brief "Noted, sir") plus a dedicated review
  page where the user can view, edit, correct, pin, and "forget" any fact.
- **Storage approach:** structured fact table (Approach A), not a markdown blob
  and not a vector store. One user → small data → inject relevant facts directly;
  no embeddings/RAG infrastructure needed (revisit only if memory grows large).
- **Review page location:** dedicated **Profile** tab.
- **Extraction model:** fast/cheap (Haiku-tier), since it runs off the critical
  path in the background.

## Architecture

A new auto-mounting module **`backend/modules/profile/`** (router → `/api/profile`),
following the existing module pattern (model registered in `db.py::init_db`,
`router` exported from `__init__.py`). It owns a single table of discrete facts —
the store of everything JARVIS knows about the user.

A small set of seams connect it to the rest of the app:

- **Capture:** explicit "remember that…" handling + a background extraction pass
  that runs after each chat/voice turn.
- **Recall:** a `get_context(db)` helper injected into both the chat prompt and
  the action planner's system prompt.
- **Oversight:** CRUD endpoints behind a new Profile tab in the frontend.

```
User turn ──► chat/voice reply (unchanged latency)
                   │
                   └─(BackgroundTask, non-blocking)─► extract_facts() ──► UserFact table
                                                                              │
profile.get_context(db) ◄─────────────────────────────────────────────────────┘
   │
   ├──► chat/router.py  _build_context  (typed + voice replies)
   └──► agent/service.py plan           (action planner — previously blind)
```

## Data model

`backend/modules/profile/models.py` — `UserFact` (SQLAlchemy 2.0 `Mapped[]`,
consistent with the codebase):

| Field | Type | Notes |
|---|---|---|
| `id` | `int` PK | |
| `category` | `str` | one of `preference`, `goal`, `routine`, `relationship`, `context`, `dislike`, `other` |
| `content` | `str` | the fact in plain third-person, e.g. "Prefers training in the morning" |
| `source` | `str` | `explicit` (user told him) or `inferred` (auto-extracted) |
| `confidence` | `float` | 0–1; `1.0` for explicit, lower for inferred; shown on the review page |
| `status` | `str` | `active` or `archived`; "forget" is a soft-delete |
| `pinned` | `bool` | pinned facts are always included in context |
| `created_at` | `datetime` | default now |
| `updated_at` | `datetime` | default now, updated on patch |

Rationale: a flat fact table makes the review page, dedup, "forget," confidence,
and per-fact editing trivial — each fact is an independent, inspectable unit. It
stays small enough for one user that direct injection beats any retrieval system.

## Capture

`backend/modules/profile/extract.py` plus a small hook in the chat/voice flow.

### Explicit ("remember that…")
There is a **single capture path** — the background extractor — to avoid a
brittle parallel regex path. When the user's message clearly instructs JARVIS to
remember something, the extractor recognizes it and saves the fact with
`source = explicit`, `confidence = 1.0`. The user-facing **acknowledgment**
("Noted, sir.") is just the assistant's normal conversational reply, driven by
the persona — it is not a synchronous guarantee tied to the DB write. The review
page remains the source of truth for what was actually persisted. (Persistence
lands a beat later via the background task, which is acceptable for a single
local user.)

### Auto-extraction (background, non-blocking)
After the chat/voice response is produced, the just-completed turn (latest user
message + assistant reply) is handed to a FastAPI `BackgroundTask` so it **never
blocks the reply**. The task:

1. Calls the LLM (Haiku-tier) with the recent turn **and the current active fact
   list**, asking for only *new or changed* facts as JSON:
   `[{"action": "add"|"update"|"archive", "id"?: int, "category": str, "content": str, "confidence": float, "source": "inferred"|"explicit"}]`
2. Because it sees existing facts, it **dedupes** and can **update** a stale fact
   (e.g. "now prefers evening workouts") rather than appending a duplicate, or
   **archive** one that's been contradicted.
3. Writes results silently via the storage layer.

Extractor prompt safeguards:
- Never store secrets, passwords, API keys, or credential-file contents.
- Skip transient chatter (e.g. "what's the weather") — store only durable facts
  about the user, their goals, preferences, relationships, and how they work.
- Return an empty list when there's nothing worth saving.

All extraction errors are swallowed — a failed background pass must never affect
a user-facing reply.

## Recall / usage

`backend/modules/profile/storage.py::get_context(db) -> str` renders active facts
into a compact block: **pinned first, then by confidence desc, then recency**,
capped (e.g. top 50) to keep the prompt lean. Empty store → empty string.

Injected in two places:

1. **`chat/router.py::_build_context`** — appended to the existing
   tasks/goals/finance snapshot for typed and voice replies.
2. **`agent/service.py::plan`** — added to the planner's system prompt. This is
   the key fix: the planner stops being blind and can pick better actions/replies
   grounded in who the user is.

Proactivity (per the locked decision): the briefing (`chat/router.py::daily_briefing`)
and planner instructions are extended to connect the current moment to known
facts ("this lines up with your goal of X — shall I…?") and to initiate actions
toward the user's goals, still confirming anything irreversible.

## Review page — "What JARVIS knows about me"

A new **Profile** tab in the frontend (`web/app/(console)/profile/page.tsx`),
added to the nav, backed by:

| Endpoint | Purpose |
|---|---|
| `GET /api/profile` | list active facts grouped by category |
| `POST /api/profile` | add a fact manually (`source = explicit`) |
| `PATCH /api/profile/{id}` | edit content/category/confidence, pin/unpin, archive |
| `DELETE /api/profile/{id}` | archive (soft "forget") |

The page lists each fact with its **category**, **source**, and **confidence**,
inline-editable, with **pin** and **forget** controls. An `api.ts` client section
mirrors the existing `tax`/`flyover` helpers.

## Error handling & privacy

- **Local-only:** SQLite, same as the rest of the app. Facts are never sent
  anywhere without explicit user confirmation (existing guardrail).
- **No secrets:** the extractor is instructed never to store secrets/keys; this
  extends the app-wide no-secrets rule.
- **Resilience:** background extraction swallows all exceptions; the LLM JSON is
  parsed with the same robust fence-stripping/brace-extraction approach already
  used in `agent/service.py::_parse`. Malformed output → no writes, no error
  surfaced.

## Testing

Mirrors the existing `tests/` style (`FakeDB` + monkeypatched provider, e.g.
`tests/test_agent.py`):

- **Model/storage CRUD** — add, list (active only), patch (edit/pin/archive),
  soft-delete.
- **Extraction parsing + dedup** — mock provider returns JSON; assert add /
  update-existing / archive actions resolve correctly against a seeded fact list;
  assert malformed output yields no writes.
- **`get_context` rendering** — pinned-first ordering, confidence ordering, cap,
  empty-store → empty string.
- **Endpoints** — list/add/patch/delete via the FastAPI test client.

## File structure

**Create:**
- `backend/modules/profile/__init__.py` — exports `router`
- `backend/modules/profile/models.py` — `UserFact`
- `backend/modules/profile/storage.py` — CRUD + `get_context`
- `backend/modules/profile/extract.py` — background extraction (LLM → facts)
- `backend/modules/profile/router.py` — `/api/profile` endpoints
- `web/app/(console)/profile/page.tsx` — review page
- `tests/test_profile.py` — backend tests

**Modify:**
- `backend/core/db.py` — register `UserFact` in `init_db`
- `backend/modules/chat/router.py` — inject `get_context`; trigger background
  extraction after replies; extend briefing for proactivity
- `backend/modules/agent/service.py` — inject `get_context` into `plan`; allow
  proactive action initiation grounded in facts
- `web/lib/api.ts` — `profile` client helpers + `UserFact` type
- frontend nav/layout — add the Profile tab

## Future / out of scope (separate spec + plan)

- **Dedicated chat UI** ("incorporate a chat as well") — a richer text-chat
  interface in the app. The memory system here is deliberately built to feed from
  and into any conversation surface (extraction hooks the chat turn; recall feeds
  the chat prompt), so the chat UI is a clean near-term follow-up, not a
  dependency of this work.
- **Semantic retrieval (RAG/embeddings)** — only if the fact store ever grows
  large enough that direct injection strains the prompt. Add ranking/usage fields
  then.
- **API-key latency fix** — switching `LLM_PROVIDER` to the Anthropic API (once a
  valid key exists) speeds up extraction and replies, but is independent of this
  design.
