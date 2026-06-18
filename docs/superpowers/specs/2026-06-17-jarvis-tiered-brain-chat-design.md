# JARVIS Tiered Brain + Claude-Code-style Chat — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorm) — pending implementation plan

## Goal

Make JARVIS as capable as the agent the user talks to in this CLI, in two parts:

1. **Tiered brain (option C):** a dispatcher that keeps simple requests fast but
   escalates hard, multi-step, or data-heavy requests to the full agentic Claude
   (the Max-plan CLI — Opus + tools). Applies to **both voice and chat**.
2. **In-app chat that emulates Claude Code:** a persistent conversation with
   streaming replies, a live **todo list**, and visible tool use, plus slash
   commands `/model`, `/compact`, `/brainstorm`, `/help` — styled to the JARVIS
   console.

## Problem

The voice/chat brain is a single-shot planner on `claude-sonnet-4-6` (API). It
can reply, run one of four actions, or pick a skill — then it stops. It cannot
reason across many steps, read files, search-and-synthesize, or work a task list.
The agentic Claude in this CLI can, and the app already has a door to it
(`ClaudeCliProvider`, used today only for web search). Nothing surfaces that
power: the existing `/api/chat` is stateless, block-only, and has no escalation,
no persistence, and no slash commands.

## Decisions (locked during brainstorming)

- **Three tiers:** `fast` (Sonnet API, single-shot planner — today's path),
  `smart` (Opus API, stronger single-shot reasoning, no tools), `agent` (CLI
  agent — Opus + files/bash/web/multi-step/TodoWrite).
- **Escalation:** the fast planner gains a `{"kind":"escalate"}` decision for
  requests needing multi-step work or deep analysis of the user's data. Manual
  override via `/model` (chat) and a "think hard"/"go deep" phrase (voice).
- **Chat emulates Claude Code (Approach A):** the agent tier runs the real CLI
  agent in **stream-json** mode; the backend parses its event stream (text
  deltas, `tool_use`, **real `TodoWrite` updates**) and re-emits SSE to the UI.
  Todos and tool chips are the agent's actual ones — not synthesized.
- **Persistence:** one persistent thread (survives reloads), stored in SQLite.
  `/compact` summarizes it in place and continues.
- **Voice + chat:** tiering applies to voice too; on escalate, voice speaks an
  immediate ack, runs the agent, then speaks a concise summary.
- **Full autonomy:** the agent tier runs with **no permission gates** — it has
  the full Claude Code toolset and executes tasks end-to-end without ever
  stopping to ask the user (the user durably authorizes this for their own local
  assistant). No "reasonable" task should require a confirmation round-trip.
- **Reuse:** extend `ClaudeCliProvider` and `agent/service.plan`; reuse the chat
  context builder (`chat/router.py::_build_context`) and persona loader.

## Architecture

```
                        ┌──────────────── dispatcher (agent/service.plan) ─────────────┐
 user (voice or chat) ─►│ fast planner (Sonnet) → reply | action | skill | ESCALATE     │
                        └───────────────────────────────┬──────────────────────────────┘
                                          escalate / /model agent │
                                                                  ▼
                         ClaudeCliProvider.agent_stream()  ──►  stream-json events
                         (project cwd, Max plan, key stripped)        │ parse
                                                                      ▼
                              SSE events: text | tool | todos | done
                                   │                              │
                         chat UI (stream + todo panel)     voice (final text → spoken summary)

 persistence: ChatTurn rows (one thread) + ChatState (tier, brainstorm mode, compaction summary)
 endpoints:  GET /api/chat/thread · POST /api/chat/stream (SSE) · POST /api/chat/compact
             (existing POST /api/chat kept for voice/back-compat)
```

## Component 1 — Tier dispatcher (`agent/service.plan`)

Extend the existing planner, do not replace it.

- **Tier resolution.** `plan(db, messages, skill=None, tier=None)` gains a `tier`
  argument. If `tier` is `"agent"` (forced via `/model` or voice phrase), skip
  routing and go straight to the agent tier. If `tier` is `"smart"`, answer with
  the Opus API single-shot. Otherwise run the existing fast planner.
- **New escalate option.** `_PLAN_INSTRUCTION` gains a fourth output:
  `{"kind":"escalate","reason":"<short reason>"}` — "use this when the request
  needs multiple steps, reading files/data, web research plus synthesis, or
  deep analysis of the user's own data that a single reply can't do well."
  `_parse` accepts `("reply","action","skill","escalate")`.
- **Result shape.** `plan` returns one of the existing dicts, or
  `{"kind":"escalate","reason":...}` which callers turn into an agent run.
- **Smart tier helper.** `_smart_answer(db, messages)` builds the same system
  prompt as fast (persona + facts + skills router context) and calls the Opus
  API model (`settings.smart_model`, default `claude-opus-4-8`) via a provider
  call that honors the model override (see Component 2). Returns
  `{"kind":"reply","text":...}`.

The model-id problem: `AnthropicProvider.chat` currently ignores the `model`
override and always uses `settings.anthropic_model`. Add an opt-in: when a model
id starting with `claude-opus` (or any explicit override flagged by the caller)
is passed, honor it. Implemented as a small change in `AnthropicProvider.chat`
to use `model or self.model`. (Verify the Opus API id `claude-opus-4-8` against
the account; fall back to `self.model` on a 404 so smart tier degrades to fast.)

## Component 2 — Streaming deep-agent provider (`ClaudeCliProvider`)

Add two methods alongside `chat`/`web_answer`:

- **`agent_text(prompt, context, model=None, timeout=180) -> str`** — a
  non-streaming agentic run for **voice** (and as a fallback). Runs
  `claude -p <prompt> --output-format text --model <agent model>
  --permission-mode bypassPermissions`, `cwd = project root`, key stripped.
  Returns the final text. Used by voice escalation, where only the final answer
  is spoken.

- **`agent_stream(prompt, context, model=None, timeout=300) -> Iterator[dict]`**
  — the streaming agentic run for **chat**. Uses `subprocess.Popen` with:
  ```
  claude -p <prompt>
    --append-system-prompt <context>
    --output-format stream-json --verbose --include-partial-messages
    --model <agent model>
    --permission-mode bypassPermissions
  ```
  `bypassPermissions` gives the agent the **full toolset** (Read, Grep, Glob,
  Edit, Write, Bash, WebSearch, WebFetch, TodoWrite, …) and runs every tool
  without prompting, so a task completes in one turn.
  Read stdout line-by-line; each line is one JSON event. Translate the CLI's
  event schema into our normalized events and `yield` them:
  - assistant text (partial deltas when `--include-partial-messages` is present,
    else whole text blocks) → `{"type":"text","text": "<delta>"}`
  - a `tool_use` block named `TodoWrite` → `{"type":"todos","todos":[{content,status}…]}`
    (read from the tool input)
  - any other `tool_use` block → `{"type":"tool","name":"<Read|Bash|…>","summary":"<short>"}`
  - the final result event → `{"type":"done"}`
  On non-zero exit / parse error / timeout, yield
  `{"type":"text","text":"I ran into a problem with that, sir."}` then `done`.

Notes:
- **cwd = project root** (not tempdir) so the agent has the codebase, can reach
  the local DB/API, and uses TodoWrite naturally. This loads the project
  `CLAUDE.md` — acceptable and useful (it carries the app's guardrails). The
  quick `chat`/`web_answer` calls keep their tempdir cwd unchanged.
- **Context seeding:** `context` = persona + profile facts + the chat data
  snapshot (reuse `chat/router._build_context`), passed via
  `--append-system-prompt` so the agent can reason over the user's life data.
- **Autonomy:** the agent runs with `--permission-mode bypassPermissions` so it
  **never stops to ask** — it carries out the task with the full toolset and
  reports what it did. The user has durably authorized this for their local
  assistant. The only standing guardrails (which are *not* permission prompts):
  the app-wide secret rule (never print `.env`/credential values), and the
  context instruction to act within the user's request rather than taking
  large, clearly-unrelated destructive actions on its own initiative. When a
  task genuinely depends on missing information, the agent asks a clarifying
  question — that is a *question*, not a permission gate.
- **Exact CLI flag names must be verified against the installed `claude` during
  implementation** (e.g. `--append-system-prompt`, `--include-partial-messages`,
  the stream-json event field names). The plan's first task is a spike that runs
  the CLI once and captures real event JSON to lock the parser against.

## Component 3 — Persistence (`backend/modules/chat`)

Two new tables (registered in `core/db.py::init_db`):

- **`ChatTurn`**: `id`, `role` ("user"|"assistant"), `content` (text), `tier`
  (nullable: which brain produced an assistant turn), `created_at`. The single
  ongoing thread = all rows ordered by `created_at`.
- **`ChatState`**: a one-row table holding `tier` (sticky selected tier, default
  `"fast"`), `mode` (`""` | `"brainstorm"`), and `compaction_summary` (text,
  the running summary prepended after a `/compact`). A `get_or_create(db)` helper
  mirrors `flyover.models.get_or_create`.

The thread sent to a brain = optional `compaction_summary` (as a leading system
note) + the `ChatTurn` rows since the last compaction.

## Component 4 — Chat endpoints (`backend/modules/chat/router.py`)

Keep `POST /api/chat` (voice/back-compat) and `/briefing` unchanged. Add:

- **`GET /api/chat/thread`** → `{messages:[{role,content,tier}], tier, mode}`.
  Loads the persistent thread + current `ChatState` for the page on open.
- **`POST /api/chat/stream`** (SSE, `text/event-stream`) — body `{text, tier?}`:
  1. Persist the user `ChatTurn`.
  2. Resolve tier: explicit `tier` arg > `ChatState.tier`.
  3. If `mode == "brainstorm"`, route to the brainstorm handler (Component 6).
  4. Else call `plan(db, thread, tier=tier)`:
     - `reply` → stream the text as one/many `text` events, then `done`.
     - `action` → run via existing `agent/service.run`, stream result text, `done`.
       (Frontend actions like `navigate`/`open_flyover` are emitted as an
       `action` SSE event the chat renders as a note; chat does not navigate.)
     - `skill` → resolve as today, stream the resulting text.
     - `escalate` (or tier already `agent`) → iterate `agent_stream(...)`,
       forwarding each normalized event as an SSE event.
  5. Persist the assembled assistant text (and final todos) as one `ChatTurn`.
  - SSE framing: each event is `data: <json>\n\n`; types `text|tool|todos|action|done|error`.
- **`POST /api/chat/compact`** → summarize the current thread with the fast
  provider ("Summarize this conversation so it can continue with full context:
  open threads, decisions, the user's goals/preferences surfaced, and any
  pending todos"), store it in `ChatState.compaction_summary`, delete the
  summarized `ChatTurn` rows, return `{summary}`.

Streaming on FastAPI uses `StreamingResponse` over a generator that pulls from
the provider iterator; the fast/smart tiers (block providers) are adapted by
yielding their single string as one `text` event so the UI path is uniform.

## Component 5 — Chat UI (`web/app/(console)/chat/page.tsx`)

Rebuild the page to emulate Claude Code, in the JARVIS style (`card`/`input`/
`btn`, `jarvis-accent`, `jarvis-muted`, dark):

- **On load:** `GET /api/chat/thread` → render history + show current tier.
- **Send:** open an SSE stream to `/api/chat/stream`; append assistant text as
  `text` events arrive (token-by-token feel); render a **tool chip row** for
  `tool` events ("⛭ Read finance.db", "⛭ WebSearch …").
- **Todo panel:** when `todos` events arrive, render a live checklist beside/above
  the streaming reply — `○ pending`, `◐ in-progress`, `✓ done` — exactly like
  Claude Code's todo display. Persists within the turn; clears on next user send.
- **Tier indicator:** a small badge (Fast / Smart / Agent) reflecting `ChatState.tier`.
- **Slash menu:** typing `/` at the start opens an autocomplete listing the
  commands with one-line help; Enter/Tab completes.
- **`api.ts`:** add a `chat` client section — `thread()`, `stream(text, onEvent)`
  (using `fetch` + `ReadableStream` reader to parse SSE), `compact()`, plus types
  `ChatTurn`, `ChatEvent`. Keep the existing `ChatReply`/`api.post('/api/chat')`.

## Component 6 — Slash commands

Parsed client-side; dispatched to the right endpoint/behavior:

- **`/model [fast|smart|agent]`** — `PATCH`/POST a tier setter
  (`POST /api/chat/stream` accepts `tier`, but the sticky default is set via a
  tiny `POST /api/chat/model {tier}` updating `ChatState.tier`). With no arg,
  prints the current tier + options. Updates the badge.
- **`/compact`** — calls `POST /api/chat/compact`; replaces the visible history
  with a single "context compacted" system line + keeps streaming from there.
- **`/brainstorm`** — sets `ChatState.mode = "brainstorm"` (`POST /api/chat/mode
  {mode}`); JARVIS then asks **one question at a time** (the stream handler, in
  brainstorm mode, instructs the brain to ask a single next question or, when it
  has enough, output a short spec and clear the mode). `/exit` clears the mode.
- **`/help`** — client-rendered list of the commands.

Brainstorm mode runs on the smart tier by default (good reasoning, fast enough),
and ends by streaming a concise spec the user can copy.

## Component 7 — Voice escalation (`VoiceProvider` + voice path)

- The voice planner already calls `plan`. When it returns `escalate` (or the user
  said a "think hard"/"go deep" phrase that forces `tier="agent"`):
  - speak an immediate ack: "Let me think on that, sir."
  - call `agent_text(...)` (non-streaming) to get the final answer.
  - speak a concise spoken-form summary (reuse the voice brevity instruction:
    2–3 sentences, no markdown).
- The phrase detection lives where commands are parsed; a small set
  (`"think hard"`, `"go deep"`, `"really think"`) forces the agent tier.
- Everything else in the voice state machine is unchanged.

## Error handling & privacy

- Agent tier failure (CLI missing, non-zero exit, timeout) → graceful `text`
  event "I ran into a problem with that, sir." + `done`; chat never hangs.
- Smart tier (Opus id) 404 → fall back to fast (`self.model`).
- The CLI agent keeps the existing **key-stripping** (Max plan, no API key in the
  subprocess); no secret ever appears in events, logs, or the UI. The agent is
  instructed not to print secrets (consistent with the app-wide rule).
- SSE generators wrap the provider loop in try/except and always emit a final
  `done` so the client closes cleanly.
- Local-only: SQLite + local subprocess, like the rest of the app.

## Testing

Backend (in-memory SQLite + monkeypatched providers, mirrors `tests/test_*`):

- **Dispatcher:** `_parse` accepts `escalate`; `plan(tier="agent")` bypasses
  routing and returns an agent marker; `plan(tier="smart")` calls the smart
  helper; fast planner still returns reply/action/skill.
- **Provider parsing:** feed `agent_stream`'s line parser a captured fixture of
  real stream-json lines (from the spike) and assert it yields the expected
  `text`/`tool`/`todos`/`done` sequence, including a `TodoWrite` → `todos` event.
  (Parser is a pure function over an iterable of lines so it's unit-testable
  without spawning a subprocess.)
- **Persistence:** `ChatTurn` append + ordered load; `ChatState.get_or_create`;
  compaction deletes turns and stores the summary; thread assembly prepends the
  summary.
- **Endpoints:** `GET /api/chat/thread` shape; `POST /api/chat/stream` (with a
  stubbed provider) emits SSE frames ending in `done` and persists the assistant
  turn; `POST /api/chat/compact` returns a summary and shrinks the thread;
  `/api/chat/model` and `/api/chat/mode` update `ChatState`.
- **Back-compat:** existing `tests/test_voice.py` / chat tests still pass.

Frontend: `tsc --noEmit` for the rebuilt page + `api.ts`; the SSE parsing helper
gets a tiny standalone `tsx` assertion (parse a sample event stream string into
events), as with prior features. Live e2e is manual (stream feel + todo panel +
each slash command + a voice escalation).

## File structure

**Create:**
- `backend/modules/chat/models.py` — `ChatTurn`, `ChatState` (+ `get_or_create`)
- `tests/test_chat_stream.py` — dispatcher escalate, stream parser, persistence, endpoints
- `web/lib/sseParse.ts` (+ `web/check_sse.ts` assertion) — SSE/event parsing helper

**Modify:**
- `backend/core/config.py` — `smart_model` (default `claude-opus-4-8`), `agent_model` (default `opus`)
- `backend/core/db.py` — register `ChatTurn`, `ChatState`
- `backend/core/llm.py` — `AnthropicProvider.chat` honors model override; `ClaudeCliProvider.agent_text` + `agent_stream` (+ pure line parser)
- `backend/modules/agent/service.py` — `plan(..., tier=None)`, `escalate` kind, `_smart_answer`
- `backend/modules/agent/router.py` — `PlanIn` gains optional `tier`
- `backend/modules/chat/router.py` — `/thread`, `/stream` (SSE), `/compact`, `/model`, `/mode`
- `web/lib/api.ts` — `chat` client (thread/stream/compact/model/mode) + types
- `web/app/(console)/chat/page.tsx` — rebuilt streaming + todo + slash UI
- `web/components/voice/VoiceProvider.tsx` (+ `web/lib/voice.ts`) — "think hard" phrase + escalate handling/ack

## Decomposition (two implementation plans, built in order)

- **Plan A — Tiered brain + streaming deep-agent + voice:** config models, the
  CLI spike + `agent_text`/`agent_stream` + parser, `AnthropicProvider` override,
  `plan` escalate/smart/tier, voice escalation. Produces a working, tested deep
  brain reachable from voice.
- **Plan B — Chat surface:** `ChatTurn`/`ChatState`, the chat endpoints (SSE,
  compact, model, mode), `api.ts` client, the rebuilt page (stream + todo panel
  + slash menu). Depends on Plan A's `agent_stream`.

## Future / out of scope

- Optional per-action approval / a "careful mode" toggle (intentionally omitted
  now — the agent runs fully autonomous per the user's authorization).
- Multiple named chat threads (one persistent thread for now).
- Token-level streaming for the smart/fast API tiers (block-as-one-event is fine
  initially; can add real API streaming later).
- A `smart`/`agent` cost+latency meter in the UI.
