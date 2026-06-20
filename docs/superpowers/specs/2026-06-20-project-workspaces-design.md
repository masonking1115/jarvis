# Project Workspaces (Projects + Notion log) — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm) — pending implementation plan
**Phase:** 2a of the Project-builder evolution. Depends on Phase 1 (resumable agent). Phase 2b (manager rollup + auto-compaction) is a separate spec.

## Goal

Let JARVIS build **any of the user's projects**, not just the JARVIS repo. Reuse the existing **Projects** feature: give a project a local **repo path** and it becomes a buildable workspace with its own chat thread, its own resumable agent session (bound to that repo), and its own **Notion documentation log + summary** maintained by the agent.

## Problem

Phase 1's agent always runs in the JARVIS repo (`cwd` hardcoded) and there's one shared chat thread/session. To build a different project you need: a way to point the agent at that repo, an isolated conversation + agent session per project, and durable per-project memory. The Projects feature already models projects (name/status/notion_url) but has no local path and its Notion page is unused ("intended to be managed by an AI agent later" — now).

## Decisions (locked during brainstorming)

- **Reuse Projects** (don't create a new module): add a local `repo_path`; a project with one is *buildable*.
- **Per-project isolation:** `ChatTurn` and `ChatState` gain a `project_id`. `project_id = 0` is **General** — the main JARVIS, today's thread (existing rows migrate to it).
- **Agent cwd = the project's `repo_path`** (General = JARVIS repo, as in Phase 1). Each project resumes its own `agent_session_id`.
- **Notion = doc log + summary, written by the agent via its Notion connector** (MCP) — no backend Notion token.
  - Auto-create a project page under the JARVIS parent page `385179b73be080c8acbad5a46fd18987` when a buildable project has no `notion_url`; store the returned URL.
  - After a build turn, the agent appends a dated log entry + refreshes a short "Current status" at the top of *that* page.
  - **HARD guardrail:** the agent may only create/edit the project's own child page under the JARVIS parent — **never the parent page or anything above/outside it.**
- **Project selection:** discover git repos under `settings.workspaces_root` (default `C:\Users\mking\Downloads`) **or** paste an absolute path; surfaced as a switcher in the chat.

## Reference

- Existing `Project` (`backend/modules/projects/models.py`): `id, name, status, progress, notion_url, notes, created_at`. Router says the Notion page is "intended to be managed by an AI agent later."
- Phase 1 agent: `ClaudeCliProvider.agent_stream(prompt, context, model, session_id, timeout)` runs `claude -p` in `_project_cwd()` (JARVIS repo), key stripped (Max plan), `--permission-mode acceptEdits`, `--allowedTools _AGENT_ALLOWED`, `--disallowedTools _AGENT_DISALLOWED`, `--max-turns`, `--resume`.
- Chat: `ChatTurn`, `ChatState` (singleton, `get_state(db)`), `store.add_turn/load_turns/thread_messages/compact`; `/stream` agent branch uses `state.agent_session_id` (Phase 1).
- The Claude CLI has a Notion connector (`claude.ai Notion` MCP). Its tools are named `mcp__claude_ai_Notion__…` (e.g. `notion-create-pages`, `notion-update-page`, `notion-fetch`).

> **Version/auth caveat:** the agent's Notion connector must be authorized for the CLI, and `--allowedTools` must accept the Notion MCP tool/server pattern. **Task 1 is a spike** that, via `claude -p`, creates a child page titled "JARVIS test" under parent `385179b73be080c8acbad5a46fd18987`, writes a line, and confirms it never touches the parent — locking the tool-allow syntax and proving auth before we build on it.

## Architecture

```
chat (per project)                         Projects registry (reused module)
  switcher → project_id ──────────────┐      + repo_path, /discover, notion_url
                                       ▼
/api/chat/* (project_id)  ──►  store/state scoped by project_id
                                       │
   escalate/agent ──► ClaudeCliProvider.agent_stream(cwd=project.repo_path,
                          session_id=state.agent_session_id, context=+Notion instructions)
                                       │ stream-json (+ Notion MCP tool_use)
                                       ▼
   parse events → SSE (text|tool|todos|done) ; capture "NOTION_URL: <url>" → save Project.notion_url
                                       │
                          agent writes the doc log/summary to the project's Notion child page
```

## Component 1 — Project gains a local repo + discovery

- `Project.repo_path: str | None` (abs dir). `backend/core/db.py` additive column.
- `projects/schemas.py`: add `repo_path` to create/update/out.
- `projects/router.py`: existing CRUD already lets you set fields; add **`GET /api/projects/discover`** → scan `settings.workspaces_root` for directories containing `.git` (shallow, e.g. depth ≤ 2), return `[{name, path}]` (read-only; never writes). Validation on set: `repo_path` must exist and be a directory (reject otherwise with 400).
- A project is **buildable** iff `repo_path` is set and exists.

## Component 2 — Per-project chat (thread + state)

- `ChatTurn.project_id: int` (default `0`), `ChatState.project_id: int` (default `0`). Additive columns in `db.py`. Existing rows → `0` (General).
- `store`: every function takes `project_id` (default `0`) and filters/writes by it — `add_turn(db, role, content, tier=None, project_id=0)`, `load_turns(db, project_id=0)`, `thread_messages(db, project_id=0)`, `compact(db, summary, project_id=0)`.
- `get_state(db, project_id=0)` — one `ChatState` row per project (create on demand). The legacy singleton row becomes `project_id=0`.
- Chat endpoints accept `project_id` (query param, default `0`): `GET /thread`, `POST /stream`, `POST /compact`, `POST /model`, `POST /mode`. All scope to that project.

## Component 3 — Agent runs in the project's repo

- `agent_stream`/`agent_text` gain **`cwd: str | None = None`** (defaults to the JARVIS repo via `_project_cwd()`). The `/stream` agent branch passes `cwd = project.repo_path` for a buildable project (General → default).
- `--resume` is cwd-scoped, and each project has its own `agent_session_id` (its `ChatState`), so resume stays correct per project.
- Extend `_AGENT_ALLOWED` to include the Notion connector (the exact `--allowedTools` token for the MCP confirmed in the spike, e.g. `mcp__claude_ai_Notion` or per-tool names).

## Component 4 — Notion doc log + summary (agent-driven)

- `settings.notion_parent_page: str = "385179b73be080c8acbad5a46fd18987"`.
- The `/stream` agent branch builds an extra **Notion instruction block** appended to the agent context (only for buildable projects):
  - "This is project **<name>** at `<repo_path>`. Keep a Notion documentation log for it."
  - If `project.notion_url` is empty: "Create a Notion page titled **<name>** as a child of the page with id `385179b73be080c8acbad5a46fd18987`. Output its URL on its own line exactly as `NOTION_URL: <url>`."
  - Else: "The project's Notion page is `<notion_url>`."
  - "After your work this turn, append a dated bullet (what you did, what's next) to that page and refresh a short **Current status** callout at the top."
  - **"NEVER create, edit, move, or delete the parent page `385179…` or any page outside this project's own page."**
- **Capture the created URL:** the `/stream` agent branch scans assembled assistant text for `^NOTION_URL:\s*(\S+)$`; if found and the project has no `notion_url`, save it to the `Project` (and strip that line from the user-visible text).
- Writing happens through the agent's Notion MCP tools (surfaced to the UI as `tool` events, e.g. "⛭ notion-create-pages").

## Component 5 — Frontend: project switcher

- `web/lib/api.ts`: `projects` client gains `discover()` and `setRepoPath(id, path)`; `chat` client methods gain an optional `projectId` (sent as `?project_id=`).
- `ChatPanel`: a small **project dropdown** in the header — `General` + projects (buildable ones marked). Switching: set active `projectId`, reload `thread(projectId)`, and route all subsequent calls with it. An **"Add project"** affordance: list `discover()` results + a paste-path field → `setRepoPath`.
- The active project is **client state** (the UI passes `project_id`); no server-side "active" pointer. Voice stays on General for 2a.

## Data flow

`switch to project P (project_id) → GET /thread?project_id=P → user message → POST /stream?project_id=P → plan() (escalate for code) → agent_stream(cwd=P.repo_path, session_id=P.state.agent_session_id, context+=Notion block) → stream events → capture NOTION_URL → persist turn under project_id=P`

## Error handling & privacy

- `repo_path` invalid/missing → project isn't buildable; the switcher shows it as not-yet-set; the agent branch for General/non-buildable uses the JARVIS repo (today's behavior).
- Notion connector unavailable/unauthorized → the agent reports it can't reach Notion; the build still proceeds (logging is best-effort, never blocks the code work). The spike surfaces this up front.
- The Notion **parent-protection guardrail** is prompt-enforced (the agent is told never to touch the parent/outside pages). We do not have a hard API-level block; this is acceptable because the connector scopes to what the user shared, and the instruction is explicit and repeated.
- Agent stays on the free Max plan (key stripped). No secrets in events. The `NOTION_URL:` capture only stores a page URL.
- All file writes happen inside the selected `repo_path` (the agent's cwd) — never outside.

## Testing

- **Spike (task 1):** prove the agent can create a child page under parent `385179…`, write to it, and that `--allowedTools` admits the Notion connector; confirm it leaves the parent untouched. Record the working tool-allow token.
- **Projects:** `repo_path` create/update; `GET /discover` returns repos under a temp root containing `.git` dirs (use a tmp tree, monkeypatch `settings.workspaces_root`); invalid `repo_path` → 400.
- **Per-project store/state:** `add_turn`/`load_turns`/`thread_messages`/`compact`/`get_state` isolate by `project_id` (turns in project 1 don't appear in project 0); legacy rows read as project 0.
- **Endpoints:** `GET /thread?project_id=1` returns only that project's turns; `/stream` with a stubbed `_agent_stream` persists under the right `project_id`, passes `cwd` and the project's `session_id`, and **captures `NOTION_URL:`** into the `Project` while hiding that line from the streamed text.
- **Agent cwd:** `agent_stream(cwd=…)` puts the given cwd in the `Popen` call (monkeypatched), defaulting to the JARVIS repo when omitted; Notion connector token present in `--allowedTools`.
- **Back-compat:** General (project_id 0) behaves exactly as Phase 1; all prior tests pass.
- Live e2e (manual): add a project with a repo_path, switch to it, ask the agent to make a small change; confirm it edits files in that repo and creates/updates a Notion page under the JARVIS parent (and never the parent).

## File structure

**Create:**
- `tests/test_workspaces.py` — discover, repo_path validation, per-project store/state, `/stream` project scoping + NOTION_URL capture, agent cwd.

**Modify:**
- `backend/core/config.py` — `workspaces_root`, `notion_parent_page`
- `backend/modules/projects/models.py` — `repo_path`
- `backend/modules/projects/schemas.py` — `repo_path`
- `backend/modules/projects/router.py` — `GET /discover`, `repo_path` validation
- `backend/core/db.py` — additive columns: `projects.repo_path`, `chat_turns.project_id`, `chat_state.project_id`
- `backend/modules/chat/models.py` — `ChatTurn.project_id`, `ChatState.project_id`
- `backend/modules/chat/store.py` — `project_id` on all helpers + `get_state(db, project_id)`
- `backend/modules/chat/router.py` — `project_id` on `/thread`,`/stream`,`/compact`,`/model`,`/mode`; agent branch passes `cwd` + Notion instruction block + `NOTION_URL:` capture
- `backend/core/llm.py` — `agent_stream(cwd=…)`, `agent_text(cwd=…)`; Notion connector in `_AGENT_ALLOWED`
- `web/lib/api.ts` — `projects.discover/setRepoPath`; `chat.*` accept `projectId`
- `web/components/chat/ChatPanel.tsx` — project switcher + add-project; thread reload on switch

## Out of scope (Phase 2b and later)

- **Manager rollup:** the General/main JARVIS reading across all projects' Notion summaries to answer "what's happening across my projects."
- **Auto-compaction** of long per-project threads.
- Voice scoped to a project (voice stays General).
- A hard, API-level Notion parent-protection (we rely on the explicit prompt guardrail for now).
- Editing the project's Notion page from the JARVIS UI directly (the agent owns it).
