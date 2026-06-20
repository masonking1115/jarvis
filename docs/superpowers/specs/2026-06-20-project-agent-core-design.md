# Project-Agent Core (CLI + resumable sessions) — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm) — pending implementation plan
**Phase:** 1 of 3 (Project-builder evolution). Phases 2 (project binding + per-project memory + auto-compaction) and 3 (build-diff UI) are separate specs that depend on this.

## Goal

Turn JARVIS's agent tier into a **warm, resumable, accurate** coding agent so the chat can help build projects — **on the free Max-plan CLI** (no API billing). Today the agent spawns a fresh `claude -p` per message and cold-starts every turn (re-reads files, loses context). We make it **resume its session** so it retains file knowledge across turns, route code/project questions to it, let it act autonomously but safely, and have it verify its own changes.

## Problem

`ClaudeCliProvider.agent_stream`/`agent_text` run a new `claude -p` per chat message. Each turn re-discovers the codebase, forgets prior decisions, and drifts — unworkable for multi-step building. The fast/smart tiers answer code questions from the conversation (no file access) and hallucinate about the repo. Nothing verifies that edits build/pass.

## Decisions (locked during brainstorming)

- **Engine:** stay on the **Claude Code CLI** (`claude -p`) so the agent keeps using the **free Max subscription** (key stripped from the subprocess, as today). The Agent SDK would force paid API billing and is deferred — gated behind an `agent_engine` setting so we can switch later without code changes.
- **Continuity:** capture the CLI's `session_id` from the stream-json `system/init` event, persist it, and pass `--resume <session_id>` on the next agent turn. Resuming reloads the conversation **and the agent's file knowledge** — the warm-context win, still free.
- **Autonomy (safer than today):** replace blanket `--permission-mode bypassPermissions` with `--permission-mode acceptEdits` + an explicit `--allowedTools` set + `--disallowedTools` deny patterns for dangerous commands.
- **Accuracy:** route code/repo/build/test questions to the agent tier (ground truth via file reads); keep quick chat on the fast tier. The agent is instructed to **verify** (build/test/typecheck) after edits.
- **Runaway guard:** `--max-turns` cap so a loop can't spin forever.
- **cwd:** the JARVIS repo root for now. A project picker is Phase 2.
- **No async refactor:** the CLI is subprocess-based; the existing sync `/stream` generator stays.

## Reference (verified against current Claude Code CLI)

- `claude -p` authenticates with the **Max subscription** when `ANTHROPIC_API_KEY` is absent (we already strip it). Free per token.
- **Resume:** `--resume <session_id>` (or `--continue` for the most recent in the cwd) reloads a prior session; sessions are scoped to the **cwd** (must match across turns — constant here). What persists: conversation history, files read, decisions.
- **Session id:** appears in the stream-json `{"type":"system","subtype":"init","session_id":"…"}` event (first event), and on the final `result` event.
- **Permissions:** `--permission-mode` (`acceptEdits|bypassPermissions|default|dontAsk`), `--allowedTools "<names…>"`, `--disallowedTools "<patterns…>"` (e.g. `"Bash(rm *)"`). Listing a tool in `--allowedTools` pre-approves it (so headless Bash runs without a prompt); `--disallowedTools` patterns are blocked even under `acceptEdits`.
- **`--max-turns <n>`** caps the agentic loop.
- Flags already verified live earlier this session: `--output-format stream-json --verbose --include-partial-messages --append-system-prompt --model`.

> **Version caveat:** confirm `--resume`, `--max-turns`, and `--disallowedTools` syntax against the installed CLI. **Task 1 is a spike** that runs the CLI twice (turn 1 → capture `session_id`; turn 2 → `--resume` it) to prove continuity and lock the flags before building.

## Architecture

```
chat /stream (agent tier)
        │  thread (msgs)  +  ChatState.agent_session_id
        ▼
ClaudeCliProvider.agent_stream(prompt, context, session_id=…)
   claude -p  (key stripped → Max plan)
     --resume <session_id?>            ← warm: reloads files+decisions
     --append-system-prompt <context+verify>
     --permission-mode acceptEdits
     --allowedTools  Read Write Edit Bash Glob Grep WebSearch WebFetch TodoWrite
     --disallowedTools "Bash(rm *)" "Bash(git push *)" "Bash(sudo *)" "Bash(curl *)"
     --max-turns <n>  --output-format stream-json --verbose --include-partial-messages
        │ stdout (stream-json)
        ▼
core/stream_parse.parse_stream_lines  →  events: session | text | tool | todos | done
        │                                        │
        │ on "session": persist id → ChatState   └► SSE: text | tool | todos | done
        ▼
chat persists assistant turn (existing)
```

## Component 1 — Resumable agent in `ClaudeCliProvider.agent_stream`

Extend the existing method (don't rewrite):
- New optional arg `session_id: str | None`. If set, add `--resume <session_id>` to the command.
- Swap `--permission-mode bypassPermissions` → `--permission-mode acceptEdits`, and add `--allowedTools` + `--disallowedTools` (lists above) and `--max-turns settings.agent_max_turns`.
- Keep cwd = project root, key stripped, `--append-system-prompt <context>`.
- `agent_text` (voice, non-streaming) gets the same permission/allowed/disallowed/max-turns hardening, but **not** resume for Phase 1 (voice isn't part of the persistent thread yet — Phase 2).

## Component 2 — Session id capture (`core/stream_parse.py`)

`parse_stream_lines` currently ignores `system` events. Add: when it sees `type=="system"` with a `session_id` (the `init` event), `yield {"type":"session","session_id": <id>}`. Everything else unchanged. (Pure, fixture-testable.) The done/text/todos/tool contract is unchanged, so the frontend needs no changes.

## Component 3 — Chat `/stream` integration

In `chat/router.py::stream`, the escalate/agent branch:
- read `session_id = ChatState.agent_session_id` (via `get_state`).
- iterate `_agent_stream(prompt, context=context, session_id=session_id)`; for each event: on `{"type":"session"}` → persist `state.agent_session_id` (commit) and **don't** forward it to the client; otherwise forward `text|tool|todos|done` as today.
- everything else (persisting the assistant turn, own-session `SessionLocal`, sync generator) unchanged.
- If the resume fails (CLI errors because the session is stale/missing), the next run simply starts fresh: catch a non-zero/again error, clear `agent_session_id`, and the following turn runs without `--resume`. (Best-effort; never hard-fail.)

## Component 4 — Routing for accuracy (planner)

Extend `agent/service.py::_PLAN_INSTRUCTION` escalate guidance: escalate when the request concerns **the code, repository, files, building, running, testing, or debugging the project** — these need ground-truth file reads, not a guess. Everyday questions stay on the fast tier. (Reuses the existing `escalate` kind; no new shape.)

## Component 5 — Verify-after-changes

Append to the agent's `--append-system-prompt` context: after editing code, **run the project's build/tests/typecheck** (e.g. `python -m pytest -q`, `npx tsc --noEmit`) and report pass/fail briefly; if something fails, fix and re-verify before claiming done.

## Component 6 — Safe autonomy (deny set)

`--disallowedTools` blocks the dangerous patterns even under `acceptEdits`: `Bash(rm *)`, `Bash(git push *)`, `Bash(sudo *)`, `Bash(curl *)`, `Bash(:(){*`, `Bash(mkfs*)`, `Bash(dd *)`, `Bash(shutdown*)`. Also add a project `.claude/settings.json` `permissions.deny` list with the same patterns as a durable backstop (the CLI reads it from the cwd). `--allowedTools` is the positive set (Component 1).

## Config (backend/core/config.py)

- `agent_engine: str = "cli"` — `"cli"` (Max plan, this spec) | `"sdk"` (paid; future Phase). Reserved now; only `"cli"` implemented.
- `agent_max_turns: int = 30`.
- (No new auth config — agent stays on the Max plan via the existing key-stripping.)

## Data model (backend/modules/chat)

- `ChatState.agent_session_id: str` (default `""`) — the resumable CLI session for the thread. Lightweight column add in `db.py` (mirrors existing additive migrations).

## Error handling & privacy

- Resume failure → clear `agent_session_id`, start fresh next turn; never hard-fail.
- CLI missing / non-zero exit / timeout → existing graceful `text` + `done`.
- `--disallowedTools` + `settings.json` deny are the hard safety floor under `acceptEdits`.
- Key-stripping unchanged: the agent never receives the API key; nothing bills; no secret in events.
- The agent keeps the persona rule against printing secrets.

## Testing

- **Spike (task 1):** run the CLI for one turn capturing `session_id`, then a second turn with `--resume <id>` asking "what file did you just read?" to confirm continuity; record the working flags. Save a few real stream-json lines (incl. the `system/init` with `session_id`) as a parser fixture.
- **`parse_stream_lines` (pure):** new test — a `system/init` line yields a `{"type":"session","session_id":…}` event; existing text/todos/tool/done behavior unchanged (run existing tests).
- **`agent_stream` command:** with `subprocess`/`Popen` monkeypatched, assert the command includes `--resume <id>` when a session id is given (and omits it when not), includes `acceptEdits`, the `--allowedTools`/`--disallowedTools` sets, `--max-turns`, and still strips `ANTHROPIC_API_KEY`.
- **`/stream` agent branch:** with a stubbed `_agent_stream` that emits a `session` event then text+done, assert `ChatState.agent_session_id` is persisted and the `session` event is **not** sent to the client; the assistant turn is saved.
- **Routing:** planner escalates a code/project question (mock provider → escalate); a quick question stays reply.
- **Back-compat:** all existing chat/voice/vision tests pass.
- Live multi-turn continuity (resume retains file knowledge across two chat messages) is a manual e2e step.

## File structure

**Create:**
- `tests/test_agent_resume.py` — parser `session` event, `agent_stream` command flags, `/stream` session persistence
- `.claude/settings.json` (project) — `permissions.deny` backstop list

**Modify:**
- `backend/core/config.py` — `agent_engine`, `agent_max_turns`
- `backend/core/stream_parse.py` — emit a `session` event from `system/init`
- `backend/core/llm.py` — `ClaudeCliProvider.agent_stream(session_id=…)` + permission/allowed/disallowed/max-turns hardening; `agent_text` hardening
- `backend/modules/chat/models.py` — `ChatState.agent_session_id`
- `backend/core/db.py` — additive column for `agent_session_id`
- `backend/modules/chat/router.py` — pass/persist `session_id` in the agent branch; swallow the `session` event
- `backend/modules/agent/service.py` — `_PLAN_INSTRUCTION` escalate guidance for code/project questions

## Out of scope (later phases)

- **Phase 2:** project picker / active-project binding (cwd selection), per-project `CLAUDE.md`/memory, auto-compaction of the chat thread, voice escalation resume.
- **Phase 3:** build-diff UI (files touched, diffs, test-result panel), richer interrupt/steer.
- **Agent SDK / paid API engine** (`agent_engine="sdk"`): the in-process warm client + permission callbacks + cost surfacing — added when paid billing is acceptable. The `agent_engine` flag reserves the seam.
