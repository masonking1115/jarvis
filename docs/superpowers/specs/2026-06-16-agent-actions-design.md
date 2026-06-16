# JARVIS Action Layer — Design Spec

**Status:** Approved design (2026-06-16)
**Feature:** Give JARVIS the ability to *act* on voice commands — web search, weather lookup, and GUI navigation — with a spoken **acknowledgement → result** flow ("Yes sir, performing the weather search now… it's 64° and clear, sir."). Actions live in an extensible registry so Slack/Linear can be added later.

---

## 1. Goal
When the user speaks a command, JARVIS decides whether it's a plain answer or an **action**. For actions it speaks an immediate acknowledgement, performs the action, then speaks the result. Web search + navigation run **without confirmation** (read-only / navigation). The registry is built so new actions (Slack, Linear) slot in without rework.

## 2. Decisions (locked)
- **Web search:** the Claude Code CLI's own **WebSearch/WebFetch** tools (no extra API key) — enabled only on the search call.
- **GUI control:** **navigate + open views** (switch console tabs, open the flyover) — no form operation in v1.
- **Permissions:** web search + navigation **auto-execute**. Future *write* actions (Slack send, Linear create) will be approve-then-act — added with those apps.
- **UX:** two-phase — fast plan (ack) → execute → spoken result. Wired into the **voice** flow; typed chat is unchanged in v1.
- **Weather** uses the existing OpenWeather integration (geocode + current), not web search — fast and reliable (the canonical example must always work).

## 3. Architecture
```
voice command → POST /api/agent/plan  (fast model, haiku)  → JSON:
   { kind:"reply", text }                         → speak(text)
   { kind:"action", tool, args, ack }             → speak(ack); then:
        frontend tool (navigate/open_flyover) → browser executes; (ack is the confirmation)
        backend  tool (web_search/weather)    → POST /api/agent/run {tool,args} → {text} → speak(text)
```
- **Action registry** (backend, single source of truth): each tool = `{name, where:"backend"|"frontend", desc, args}`. The plan prompt is generated from it; the frontend has a matching dispatch map for `where:"frontend"` tools.
- **Frontend tools** never hit `/run`; the browser performs them (router navigation, opening the flyover).
- **Backend tools** are executed server-side in `/run` and return a spoken-ready `text`.

## 4. Backend: `backend/modules/agent/`
### 4.1 Registry (`registry.py`)
```
TOOLS = [
  {name:"web_search", where:"backend",
   desc:"Search the web for current info, facts, news, prices, etc.",
   args:"query (string): what to search for"},
  {name:"weather", where:"backend",
   desc:"Current weather conditions for a place.",
   args:"location (string, optional): city/address; omit for the user's saved location"},
  {name:"navigate", where:"frontend",
   desc:"Open a section of the JARVIS console.",
   args:"target (string): one of dashboard, finance, spending, email, fitness, workouts, projects, trading, agents, notes, settings, goals, schedule, tax"},
  {name:"open_flyover", where:"frontend",
   desc:"Open the full-screen photoreal map/flyover of the user's address.",
   args:"(none)"},
]
```
A helper renders the tool list into the plan prompt. Adding Slack/Linear = append entries (+ executors).

### 4.2 Plan (`service.plan`)
- Build a system prompt = JARVIS persona (`chat.load_persona()`) + the registry block + strict-JSON instruction. Include the recent messages.
- Call the LLM with the **fast** model (`settings.voice_model`).
- Parse JSON robustly (strip ``` fences, take first `{...}` block). On any failure → `{kind:"reply", text:<raw or fallback>}`.
- Validate: if `tool` not in the registry → treat as reply. Returns the dict.

### 4.3 Run (`service.run`)
Executes **backend** tools only:
- `web_search`: shell the Claude CLI with web tools allowed —
  `claude -p "<query>" --allowedTools WebSearch WebFetch --output-format text --model <agent_search_model>`
  in a temp cwd, key-stripped env (reuse the ClaudeCliProvider plumbing). Prompt wraps the query: "Search the web and answer for spoken delivery: 2-3 sentences, no markdown." Returns the text.
  - If the CLI can't use tools headlessly, fall back to a plain CLI answer prefixed with a caveat. (Verified at build time; flag in plan.)
- `weather`: geocode `args.location` (or saved location) via `flyover.geocode`/settings, fetch `flyover.weather.current`, format one spoken line: "It's 64°, clear sky, in Atherton, sir." No LLM needed (fast).
- Unknown backend tool → `{text:"I'm not able to do that yet, sir."}`.

### 4.4 Router (`router.py`)
- `POST /api/agent/plan` `{messages}` → plan dict.
- `POST /api/agent/run` `{tool, args}` → `{text}` (backend tools). Degrades to a spoken apology on error; never leaks keys.
- `GET /api/agent/tools` → the registry (for the frontend dispatch map / debugging).

### 4.5 Config
- `agent_search_model: str = "sonnet"` (quality for synthesis; ack hides latency).

## 5. Frontend
### 5.1 VoiceProvider — agent flow (replaces the direct `/api/chat` call in `handle`)
1. `set("thinking")`; `POST /api/agent/plan {messages}`.
2. `kind:"reply"` → `speak(text)` (existing path).
3. `kind:"action"`:
   - `speak(ack)` immediately.
   - If `tool` is a **frontend** tool → execute it (see 5.2). After the ack audio ends → conversation mode (no second utterance needed).
   - If a **backend** tool → kick off `POST /api/agent/run {tool,args}` *in parallel* with the ack playing; when the ack audio ends **and** the result is back, `speak(result)`.
- Keep the rolling message history; append the user msg and a short assistant summary.

### 5.2 Frontend action dispatch
- `navigate`: `router.push("/" + target)` (validate against the known route list).
- `open_flyover`: `window.dispatchEvent(new CustomEvent("jarvis:flyover"))`.
- `FlyoverProvider` adds a listener for `jarvis:flyover` → `setOpen(true)` (VoiceProvider wraps FlyoverProvider, so it can't use the hook directly — a window event bridges them).

### 5.3 Sequencing helper
A small "speak A, then speak B when both A-finished and B-ready" chain (promise on audio `ended` + the run fetch) so the ack always precedes the result and they never overlap.

## 6. Latency
- Plan call uses haiku (fast). For actions, the ack is spoken right away; `web_search` (the slow part) runs while the ack plays. `navigate`/`weather` are near-instant. Net: it *feels* responsive even when the search takes a few seconds.

## 7. Error handling & degradation
- **Plan JSON unparseable / model didn't follow format** → treat as a plain reply (speak whatever text came back, or a safe fallback).
- **Unknown/again-unsupported tool** → spoken "I can't do that yet, sir."
- **web_search tool unavailable in CLI** → fall back to a best-effort CLI answer with a brief caveat; never error out.
- **weather geocode/api failure** → "I couldn't fetch the weather right now, sir."
- Keys (OpenWeather, etc.) never appear in any response or log.

## 8. Testing
- **Backend (pytest):** registry renders into the prompt; `plan` JSON parsing (clean, fenced, garbage→reply, unknown tool→reply) with a mocked provider; `run(weather)` formats a line from mocked geocode/current; `run(web_search)` calls the CLI with `WebSearch`/`WebFetch` in `--allowedTools` (mock subprocess); no key in outputs.
- **Frontend:** pure dispatch/validation (typecheck) + manual voice checklist (ack→search→result; "open my finances" navigates; "open the map" opens flyover).

## 9. Out of scope (v1 — YAGNI)
Form operation / clicking arbitrary controls; the agent layer in *typed* chat; Slack/Linear (added later as registry entries with write-confirmation); multi-step action chaining; long-running/background actions.

## 10. Extensibility note (Slack/Linear later)
Adding an app = (1) integrate the app's API/module, (2) append registry entries (e.g. `slack_send`, `linear_create`) with `where:"backend"`, (3) implement their executors in `service.run`, (4) for write actions, return `{needs_confirm:true, ...}` and have the voice flow confirm before a second `/run` call. No changes to the plan/dispatch core.
