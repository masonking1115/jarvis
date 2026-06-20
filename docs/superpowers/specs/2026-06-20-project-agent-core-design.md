# Project-Agent Core (Claude Agent SDK) — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm) — pending implementation plan
**Phase:** 1 of 3 (Project-builder evolution). Phases 2 (project binding + per-project memory + auto-compaction) and 3 (build-diff UI) are separate specs that depend on this.

## Goal

Turn JARVIS's agent tier into a **warm, resumable, accurate** coding agent so the chat can help build projects. Replace the per-message `claude -p` subprocess (which cold-starts every turn and loses its working context) with a **session-managed Claude Agent SDK** agent that retains file knowledge across turns, is routed to for code/project questions, runs autonomously but safely, and verifies its own changes.

## Problem

Today the agent tier (`ClaudeCliProvider.agent_stream` / `agent_text`) spawns a fresh `claude -p` per chat message. Each turn it re-reads files, forgets prior decisions, and can drift — unworkable for multi-step project building. The fast/smart tiers answer code questions from the conversation (no file access) and hallucinate about the repo. There's no verification that edits actually build/pass.

## Decisions (locked during brainstorming)

- **Engine:** migrate the agent tier to the **Python Claude Agent SDK** (`claude-agent-sdk`), not the CLI. (User accepts API-key billing; the rest of JARVIS already uses the API key — only the agent tier was on the free Max-plan CLI.)
- **Continuity:** a **warm `ClaudeSDKClient` per chat thread**, with its `session_id` persisted so it **resumes** (retaining file knowledge) after a server restart.
- **Autonomy:** `permission_mode="acceptEdits"` + an explicit `allowed_tools` list + a **deny callback** for dangerous commands. Not full `bypassPermissions` — the deny callback is the safety floor.
- **Accuracy:** route code/repo/build/test questions to the agent tier (ground truth via file reads); keep quick chat on the fast tier. Instruct the agent to **verify** (build/test/typecheck) after edits.
- **Cost controls:** `max_turns` cap, default model `sonnet` (escalate to `opus` only on request), surface `total_cost_usd`.
- **Scope:** the agent runs in the **JARVIS repo root** for now (cwd). A project picker is Phase 2.
- **Fallback:** if the SDK import fails or no API key, fall back to the existing `ClaudeCliProvider.agent_stream` (free Max plan) so the agent tier never hard-breaks.

## Reference (verified against current Claude Agent SDK docs)

- Package: `claude-agent-sdk` (pip). `from claude_agent_sdk import query, ClaudeSDKClient, ClaudeAgentOptions` and message types `AssistantMessage, ResultMessage, SystemMessage` plus `StreamEvent` (from `claude_agent_sdk.types`).
- **Auth:** the SDK calls the Anthropic API directly and **requires `ANTHROPIC_API_KEY`** (it does NOT inherit Max-plan subscription auth). Paid per token.
- **Multi-turn:** `ClaudeSDKClient` keeps context across `query()`/`receive_response()` calls automatically; `ClaudeAgentOptions(resume=<session_id>)` resumes a prior session from `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (cwd must match exactly).
- **Streaming:** with `include_partial_messages=True`, `receive_response()` yields `StreamEvent` (raw API events: `content_block_delta`/`text_delta`, `content_block_start` tool_use, …), `AssistantMessage` (complete blocks), `ResultMessage` (final, `result` + `session_id` + `total_cost_usd`), `SystemMessage` (`subtype=="init"` carries `session_id`).
- **Options:** `permission_mode` (`acceptEdits|bypassPermissions|dontAsk|default`), `allowed_tools`, `can_use_tool` (async callback returning `PermissionResultAllow`/`PermissionResultDeny`), `cwd`, `model`, `max_turns`, `system_prompt`/append, `hooks`.
- Windows-supported; the Python SDK does NOT require the `claude` CLI binary.

> **Version caveat:** exact message field paths and option names can shift between SDK versions. **The first implementation task is a spike** that runs the installed SDK once and captures the real message objects, so the streaming bridge is built against reality (mirrors how we captured the stream-json fixture earlier).

## Architecture

```
chat /stream (agent tier)                    voice escalation (later)
        │                                            │
        ▼                                            ▼
  core/agent_sdk.py  ──  AgentSession (warm ClaudeSDKClient, keyed by thread)
        │  options: cwd=repo root, model, acceptEdits, allowed_tools, can_use_tool(deny), partial msgs
        │  session_id ⇄ ChatState (persist + resume after restart)
        ▼
  receive_response() events ──► normalize ──► SSE: text | tool | todos | done(cost)
        │
        └─ on SDK import / key failure ──► fallback: ClaudeCliProvider.agent_stream (free Max plan)
```

## Component 1 — `core/agent_sdk.py` (session-managed provider)

A small module owning the agent session lifecycle.

- **`_deny_tool(tool_name, input_data, context)`** — async `can_use_tool` callback. Denies destructive/outbound commands regardless of mode: Bash matching `rm -rf`, `rm ` of non-temp paths, `git push`, `:(){`, `mkfs`, `dd `, `shutdown`, `curl … | sh`, `sudo`; otherwise allow. Returns `PermissionResultDeny(message=…)` / `PermissionResultAllow(updated_input=input_data)`.
- **`build_options(cwd, model, resume=None, context_prompt="") -> ClaudeAgentOptions`** — central config: `permission_mode="acceptEdits"`, `allowed_tools=["Read","Write","Edit","Bash","Glob","Grep","WebSearch","WebFetch","TodoWrite"]`, `can_use_tool=_deny_tool`, `cwd`, `model`, `include_partial_messages=True`, `max_turns=settings.agent_max_turns`, `resume=resume`, and `system_prompt` (append) = the verify-and-be-concise instruction + JARVIS context.
- **`AgentSession`** — wraps one `ClaudeSDKClient`:
  - `async ensure(db)` — lazily `connect()` the client (creating with `resume=ChatState.agent_session_id` if present); ensure `os.environ["ANTHROPIC_API_KEY"]` is the authoritative `.env` key before connecting (the app keeps `.env` as the source of truth — see config.py).
  - `async run(db, prompt, context) -> AsyncIterator[dict]` — `await client.query(prompt)`, then `async for msg in client.receive_response()` → yield normalized events (Component 2). On the first `SystemMessage(init)` / `ResultMessage`, persist `session_id` to `ChatState` (`agent_session_id`).
  - Module-level `_SESSIONS: dict[str, AgentSession]` keyed by thread id ("default" for the single thread). Best-effort; recreated on error.
- **`available() -> bool`** — true if `claude_agent_sdk` imports AND `settings.anthropic_api_key` is set.

## Component 2 — Streaming bridge (SDK message → SSE event)

Pure function `normalize(msg) -> list[dict]` (testable without the SDK, fed captured fixtures from the spike):
- `StreamEvent` `content_block_delta`/`text_delta` → `{"type":"text","text":…}`
- `StreamEvent`/`AssistantMessage` `tool_use` named `TodoWrite` → `{"type":"todos","todos":[{content,status}…]}`
- other `tool_use` → `{"type":"tool","name":…,"summary":…}`
- `ResultMessage` → `{"type":"done","text":result,"cost":total_cost_usd}`
- ignore thinking / system noise.

Mirrors the existing `core/stream_parse.py` contract so the frontend needs **no changes** (it already renders text/tool/todos/done).

## Component 3 — Chat `/stream` integration

In `chat/router.py::stream`, the escalate/agent branch:
- if `agent_sdk.available()` → iterate `agent_sdk.session("default").run(db, prompt, context)`, forwarding normalized events; persist the assembled assistant text (+ session id already persisted in the session).
- else → current `_agent_stream` (CLI) fallback, unchanged.

`/stream` becomes an **async** endpoint with an async generator (the SDK is async). The fast/smart branches call the sync provider via `await asyncio.to_thread(...)` so the event loop isn't blocked. The own-session DB pattern (`SessionLocal`) is unchanged.

## Component 4 — Routing for accuracy (planner)

Extend the planner's escalate guidance (`agent/service.py::_PLAN_INSTRUCTION`): escalate when the request concerns **the code, repository, files, building, running, testing, or debugging the project** — these need ground-truth file reads, not a guess. Everyday questions stay on the fast tier. (No new kind; reuses `escalate`.)

## Component 5 — Verify-after-changes

The agent's appended system prompt instructs: after editing code, **run the project's build/tests/typecheck** (e.g. `pytest -q`, `npx tsc --noEmit`) and report pass/fail succinctly; if something fails, fix and re-verify before claiming done. (The agent already has Bash; this makes verification the default.)

## Component 6 — Cost controls

- `settings.agent_max_turns` (default 30) → `max_turns`.
- Default agent model `sonnet` (`settings.agent_model` already exists); `opus` only when the user asks ("go deep"/"use opus") — the tier resolution passes the model through.
- The `done` event carries `cost`; the chat UI shows it subtly (small "$0.0x" on the agent turn). Surfacing cost keeps the paid tradeoff visible.

## Config (backend/core/config.py)

- `agent_engine: str = "sdk"` — `"sdk"` | `"cli"` (lets us flip back to the free CLI without code changes).
- `agent_max_turns: int = 30`.
- Reuse `anthropic_api_key`, `agent_model`.

## Error handling & privacy

- SDK import error or empty key → `available()` false → CLI fallback (free) → if that's also unavailable, a graceful `text` event + `done`.
- The deny callback is the hard safety floor even under `acceptEdits`.
- Secrets: the SDK runs locally; the API key stays server-side; never emit it in events. The agent keeps the persona rule against printing secrets.
- Any SDK exception inside the stream is caught → emits a safe `text` + `done`; the session is reset so the next turn reconnects.
- `total_cost_usd` shown so paid usage is never hidden.

## Testing

- **Spike (task 1):** run the installed SDK once against the repo, capture real message objects to a fixture; lock field paths.
- **`normalize` (pure):** fixture-driven — assert text/todos/tool/done mapping incl. a `TodoWrite` → `todos` and `ResultMessage` cost on `done`. No SDK/process needed.
- **Deny callback:** `rm -rf`, `git push`, `curl|sh`, `sudo` → deny; `pytest`, `Read`, `Edit` → allow.
- **Session persistence:** `AgentSession` persists/reads `agent_session_id` on `ChatState` (in-memory sqlite, SDK mocked).
- **Availability/fallback:** `available()` false when key empty or import fails; `/stream` agent branch falls back to the CLI path (mocked).
- **Routing:** planner escalates a code/project question (mock provider returns escalate); quick question stays reply.
- **Back-compat:** existing chat/voice/vision tests still pass; CLI provider untouched.
- Live multi-turn continuity (resume retains file knowledge) is a manual e2e step.

## File structure

**Create:**
- `backend/core/agent_sdk.py` — `AgentSession`, `_SESSIONS`, `build_options`, `_deny_tool`, `normalize`, `available`
- `tests/test_agent_sdk.py` — normalize, deny callback, availability, session-id persistence
- `tests/fixtures/sdk_messages.jsonl` (or `.py`) — captured from the spike

**Modify:**
- `backend/core/config.py` — `agent_engine`, `agent_max_turns`
- `backend/modules/chat/models.py` — `ChatState.agent_session_id: str` (lightweight migration in `db.py`)
- `backend/modules/chat/router.py` — async `/stream`; agent branch uses `agent_sdk` (CLI fallback); thread fast/smart via `asyncio.to_thread`
- `backend/modules/agent/service.py` — `_PLAN_INSTRUCTION` escalate guidance for code/project questions
- `web/components/chat/ChatPanel.tsx` — show the optional `cost` on a completed agent turn (tiny, non-intrusive)
- `web/lib/sseParse.ts` — `done` event may carry `cost?: number`
- `requirements.txt` / install — add `claude-agent-sdk`

## Out of scope (later phases)

- **Phase 2:** project picker / active-project binding (cwd selection), per-project `CLAUDE.md`/memory, auto-compaction of the chat thread.
- **Phase 3:** build-diff UI (files touched, diffs, test results panel), richer interrupt/steer.
- Voice escalation through the SDK (Phase 1 wires chat; voice keeps the CLI path until Phase 2).
- Multi-thread / multi-project concurrent sessions.
- Mid-session dynamic tool updates, budget-USD hard cap (use `max_turns`; add `max_budget_usd` only if the installed SDK supports it — verify in the spike).
