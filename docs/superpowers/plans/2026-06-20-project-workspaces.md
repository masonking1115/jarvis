# Project Workspaces (Projects + Notion log) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let JARVIS build any of the user's projects (not just the JARVIS repo): give a Project a local `repo_path`, scope the chat thread + resumable agent session per project, run the agent in that repo, and have the agent keep a Notion doc-log/summary on a child page under the user's JARVIS page.

**Architecture:** Reuse the Projects module (add `repo_path`). Add `project_id` to `ChatTurn`/`ChatState` (`0` = General/main JARVIS = today's thread). The `/stream` agent branch passes `cwd = project.repo_path` and per-project `agent_session_id` (Phase 1 resume), plus a Notion instruction block; it captures a `NOTION_URL:` line the agent emits and saves it to the Project.

**Tech Stack:** Python/FastAPI, Claude Code CLI (Max plan), SQLAlchemy/SQLite, Next.js/React, pytest. Windows.

**Spec:** `docs/superpowers/specs/2026-06-20-project-workspaces-design.md`

## Global Constraints

- **Guardrails (active):** only edit files inside `C:\Users\mking\Downloads\JARVIS\jarvis`; no system/global changes; if unsure or looping, STOP and report.
- **Free Max plan:** the agent subprocess keeps stripping `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`.
- **venv Python for tests:** `& ".\.venv\Scripts\python.exe" -m pytest …` from repo root.
- **Confirmed in the spike (Task 1, DONE):** the Notion connector works on the personal workspace; child-page creation under parent `385179b73be080c8acbad5a46fd18987` succeeds; tool-allow tokens are `mcp__claude_ai_Notion__notion-create-pages`, `mcp__claude_ai_Notion__notion-fetch`, `mcp__claude_ai_Notion__notion-update-page`, `mcp__claude_ai_Notion__notion-search`; the agent emits `NOTION_URL: <url>`.
- **Notion parent guardrail:** the agent must only create/edit the project's own child page under the parent — never the parent or anything outside it (prompt-enforced).
- **Commits:** per task, `git -C "C:\Users\mking\Downloads\JARVIS\jarvis" …` (PowerShell, no `&&`, no apostrophes in `-m`).

---

### Task 1: Spike — Notion connector + child page (DONE)

Already executed and verified live: connector authed to the personal `My Life › Technical Ideas › JARVIS` workspace; created a child page under `385179b73be080c8acbad5a46fd18987`; returned `NOTION_URL`. Flags/tokens recorded in Global Constraints. No code. (A leftover "JARVIS connector test" page may be deleted by the user.)

---

### Task 2: Config — workspaces root + Notion parent

**Files:** Modify `backend/core/config.py` (after `agent_max_turns`)

**Interfaces:** Produces `settings.workspaces_root: str`, `settings.notion_parent_page: str`.

- [ ] **Step 1:** Add:
```python
    workspaces_root: str = r"C:\Users\mking\Downloads"   # scanned for git repos to build
    notion_parent_page: str = "385179b73be080c8acbad5a46fd18987"  # JARVIS page; agent logs under it
```
- [ ] **Step 2:** Verify: `& ".\.venv\Scripts\python.exe" -c "from backend.core.config import settings; print(settings.notion_parent_page)"` → prints the id.
- [ ] **Step 3:** Commit: `git ... add backend/core/config.py; git ... commit -m "feat(config): workspaces_root + notion_parent_page"`

---

### Task 3: Project gains repo_path + discovery

**Files:**
- Modify: `backend/modules/projects/models.py`, `backend/modules/projects/schemas.py`, `backend/modules/projects/router.py`, `backend/core/db.py`
- Test: `tests/test_projects_workspace.py` (create)

**Interfaces:**
- Produces: `Project.repo_path: str | None`; `GET /api/projects/discover` → `[{"name","path"}]`; setting `repo_path` via create/patch validates the dir exists.

- [ ] **Step 1: Write the failing test**
```python
# tests/test_projects_workspace.py
import os, tempfile
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from backend.core.db import Base, get_db
import backend.modules.projects.router as pr


@pytest.fixture
def client(monkeypatch):
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    TS = sessionmaker(bind=eng)
    def _ov():
        db = TS()
        try: yield db
        finally: db.close()
    app = FastAPI(); app.include_router(pr.router, prefix="/api/projects")
    app.dependency_overrides[get_db] = _ov
    return TestClient(app), monkeypatch


def test_create_with_valid_repo_path(client, tmp_path):
    c, _ = client
    r = c.post("/api/projects", json={"name": "Demo", "repo_path": str(tmp_path)})
    assert r.status_code == 200 and r.json()["repo_path"] == str(tmp_path)


def test_reject_missing_repo_path(client):
    c, _ = client
    r = c.post("/api/projects", json={"name": "Bad", "repo_path": "C:/does/not/exist/xyz"})
    assert r.status_code == 400


def test_discover_finds_git_repos(client, tmp_path):
    c, mp = client
    (tmp_path / "repoA" / ".git").mkdir(parents=True)
    (tmp_path / "repoB" / ".git").mkdir(parents=True)
    (tmp_path / "plain").mkdir()
    mp.setattr(pr.settings, "workspaces_root", str(tmp_path))
    names = {d["name"] for d in c.get("/api/projects/discover").json()}
    assert {"repoA", "repoB"} <= names and "plain" not in names
```

- [ ] **Step 2: Run → fail:** `& ".\.venv\Scripts\python.exe" -m pytest tests/test_projects_workspace.py -v`

- [ ] **Step 3: Implement**

`models.py` — add to `Project`:
```python
    repo_path: Mapped[str | None] = mapped_column(String(500), default=None)
```
`schemas.py` — add `repo_path: str | None = None` to `ProjectBase` and `ProjectUpdate`.
`db.py` — in `_apply_lightweight_migrations` additions dict add:
```python
        "projects": [("repo_path", "VARCHAR(500)")],
```
`router.py` — add `from backend.core.config import settings`, `import os`, a validator, and the discover route:
```python
def _validate_repo_path(path: str | None):
    if path and not os.path.isdir(path):
        raise HTTPException(400, "repo_path is not an existing directory")


@router.get("/discover")
def discover():
    root = settings.workspaces_root
    found = []
    if os.path.isdir(root):
        for name in sorted(os.listdir(root)):
            p = os.path.join(root, name)
            if os.path.isdir(os.path.join(p, ".git")):
                found.append({"name": name, "path": p})
    return found
```
In `create_project` and `update_project`, call `_validate_repo_path(payload.repo_path if hasattr(payload, "repo_path") else None)` before saving (for update use the dumped value when present). Put the `discover` route ABOVE `update_project`/`delete_project` so `/discover` isn't captured by `/{project_id}`.

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit:** `... -m "feat(projects): repo_path + git-repo discovery"`

---

### Task 4: Per-project chat models

**Files:** Modify `backend/modules/chat/models.py`, `backend/core/db.py`; Test: append `tests/test_chat_models.py`

**Interfaces:** `ChatTurn.project_id: int` (default 0), `ChatState.project_id: int` (default 0), `get_state(db, project_id=0)`.

- [ ] **Step 1: Failing test** (append):
```python
def test_state_is_per_project(db):
    s0 = get_state(db, 0); s1 = get_state(db, 1)
    assert s0.project_id == 0 and s1.project_id == 1 and s0.id != s1.id
    s1.tier = "agent"; db.commit()
    assert get_state(db, 0).tier == "fast" and get_state(db, 1).tier == "agent"
```
(Existing `test_get_state_*` tests call `get_state(db)` — keep `project_id=0` as the default so they still pass.)

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — `models.py`:
```python
    # ChatTurn:
    project_id: Mapped[int] = mapped_column(Integer, default=0, index=True)
    # ChatState:
    project_id: Mapped[int] = mapped_column(Integer, default=0, index=True)
```
Replace `get_state`:
```python
def get_state(db, project_id: int = 0) -> "ChatState":
    row = db.query(ChatState).filter(ChatState.project_id == project_id).first()
    if row is None:
        row = ChatState(project_id=project_id)
        db.add(row); db.commit(); db.refresh(row)
    return row
```
`db.py` additions dict:
```python
        "chat_turns": [("project_id", "INTEGER DEFAULT 0")],
        "chat_state": [("project_id", "INTEGER DEFAULT 0")],
```

- [ ] **Step 4: Run → pass** (`tests/test_chat_models.py`).
- [ ] **Step 5: Commit:** `... -m "feat(chat): per-project ChatTurn/ChatState"`

---

### Task 5: Project-scoped store helpers

**Files:** Modify `backend/modules/chat/store.py`; Test: append `tests/test_chat_store.py`

**Interfaces:** all helpers take `project_id: int = 0`.

- [ ] **Step 1: Failing test** (append):
```python
def test_turns_isolated_by_project(db):
    store.add_turn(db, "user", "in P1", project_id=1)
    store.add_turn(db, "user", "in P0", project_id=0)
    assert [m["content"] for m in store.thread_messages(db, 1)] == ["in P1"]
    assert [m["content"] for m in store.thread_messages(db, 0)] == ["in P0"]
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — rewrite `store.py`:
```python
"""Helpers for per-project chat threads (project_id 0 = General/main JARVIS)."""
from .models import ChatTurn, get_state


def add_turn(db, role: str, content: str, tier: str | None = None, project_id: int = 0) -> ChatTurn:
    t = ChatTurn(role=role, content=content, tier=tier, project_id=project_id)
    db.add(t); db.commit(); db.refresh(t)
    return t


def load_turns(db, project_id: int = 0) -> list[ChatTurn]:
    return (db.query(ChatTurn).filter(ChatTurn.project_id == project_id)
            .order_by(ChatTurn.created_at.asc(), ChatTurn.id.asc()).all())


def thread_messages(db, project_id: int = 0) -> list[dict]:
    state = get_state(db, project_id)
    msgs: list[dict] = []
    if state.compaction_summary:
        msgs.append({"role": "assistant",
                     "content": f"(summary of earlier conversation) {state.compaction_summary}"})
    for t in load_turns(db, project_id):
        msgs.append({"role": t.role, "content": t.content})
    return msgs


def compact(db, summary: str, project_id: int = 0) -> None:
    state = get_state(db, project_id)
    state.compaction_summary = summary
    db.query(ChatTurn).filter(ChatTurn.project_id == project_id).delete()
    db.commit()
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit:** `... -m "feat(chat): project-scoped store helpers"`

---

### Task 6: Agent cwd + Notion tools

**Files:** Modify `backend/core/llm.py`; Test: append `tests/test_agent_resume.py`

**Interfaces:** `agent_stream(..., cwd: str | None = None)` and `agent_text(..., cwd: str | None = None)` run in `cwd or self._project_cwd()`. `_AGENT_ALLOWED` includes the four Notion tools.

- [ ] **Step 1: Failing test** (append):
```python
def test_agent_stream_uses_given_cwd_and_allows_notion(monkeypatch):
    p = llm.ClaudeCliProvider.__new__(llm.ClaudeCliProvider)
    p.path = "claude"; p.available = True; p.model = "sonnet"
    captured = {}
    class _P:
        def __init__(self, cmd, **kw): captured["cmd"] = cmd; captured["cwd"] = kw.get("cwd"); self.stdout = iter(['{"type":"result","result":"ok"}']); self.returncode = 0
        def wait(self, timeout=None): return 0
        def kill(self): pass
    monkeypatch.setattr(subprocess, "Popen", _P)
    list(p.agent_stream("hi", cwd=r"C:\tmp\proj"))
    assert captured["cwd"] == r"C:\tmp\proj"
    assert any("notion-create-pages" in t for t in captured["cmd"])
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — in `llm.py` extend `_AGENT_ALLOWED`:
```python
_AGENT_ALLOWED = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite",
                  "mcp__claude_ai_Notion__notion-create-pages", "mcp__claude_ai_Notion__notion-fetch",
                  "mcp__claude_ai_Notion__notion-update-page", "mcp__claude_ai_Notion__notion-search"]
```
Add `cwd: str | None = None` to both `agent_text` and `agent_stream` signatures, and change their `subprocess.run(... cwd=self._project_cwd() ...)` / `subprocess.Popen(... cwd=self._project_cwd() ...)` to `cwd=cwd or self._project_cwd()`.

- [ ] **Step 4: Run → pass;** then full suite `& ".\.venv\Scripts\python.exe" -m pytest -q`.
- [ ] **Step 5: Commit:** `... -m "feat(agent): per-project cwd + Notion connector tools"`

---

### Task 7: Chat /stream — project scoping + Notion log

**Files:** Modify `backend/modules/chat/router.py`; Test: append `tests/test_chat_stream_endpoint.py`

**Interfaces:** all chat endpoints accept `project_id: int = 0` (query). Agent branch passes `cwd`/`session_id` for the project, appends Notion instructions for buildable projects, captures `NOTION_URL:` → `Project.notion_url`.

- [ ] **Step 1: Failing test** (append) — uses the existing `ctx` fixture `(client, TestingSession)`:
```python
def test_stream_scopes_project_and_captures_notion_url(ctx, monkeypatch):
    client, TS = ctx
    # seed a buildable project (id 1) with a repo_path
    from backend.modules.projects.models import Project
    db = TS(); proj = Project(name="Demo", repo_path="."); db.add(proj); db.commit(); pid = proj.id
    monkeypatch.setattr(cr.service, "plan",
        lambda db, msgs, skill=None, tier=None, extra_context=None: {"kind": "escalate", "reason": "x"})
    seen = {}
    def fake_stream(prompt, context="", session_id=None, cwd=None):
        seen["cwd"] = cwd; seen["ctx"] = context
        yield {"type": "text", "text": "did work\nNOTION_URL: https://notion.so/p/abc"}
        yield {"type": "done", "text": ""}
    monkeypatch.setattr(cr, "_agent_stream", fake_stream)

    r = client.post(f"/api/chat/stream?project_id={pid}", json={"text": "build it", "tier": "agent"})
    assert "did work" in r.text and "NOTION_URL" not in r.text.split("data:")[-1]  # stripped from final
    db2 = TS(); saved = db2.get(Project, pid)
    assert saved.notion_url == "https://notion.so/p/abc"          # captured
    assert seen["cwd"] == "."                                      # ran in the project repo
    assert "Notion documentation log" in seen["ctx"]              # instructions injected
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — in `chat/router.py`:

Add imports: `import re` and `from backend.modules.projects.models import Project`.

Add the Notion-instruction helper:
```python
def _notion_instructions(proj: "Project") -> str:
    parent = settings.notion_parent_page
    where = (f"This project's Notion documentation page is {proj.notion_url}."
             if proj.notion_url else
             f"This project has no Notion page yet. Create a Notion page titled '{proj.name}' as a CHILD "
             f"of the page with id {parent}, then output its URL on its own line exactly as 'NOTION_URL: <url>'.")
    return ("## Notion documentation log\n"
            f"You are building the project '{proj.name}'. Keep a Notion doc log for it. {where}\n"
            "After your work this turn, append a dated bullet (what you did, what's next) to that page and "
            "refresh a short 'Current status' summary at the top.\n"
            f"NEVER create, edit, move, or delete the parent page {parent} or any page outside this project's own page.")
```

Update `_agent_stream`:
```python
def _agent_stream(prompt: str, context: str = "", session_id: str | None = None, cwd: str | None = None, **kw):
    yield from ClaudeCliProvider().agent_stream(prompt, context=context, session_id=session_id, cwd=cwd)
```

Add `project_id: int = 0` as a query param to `thread`, `stream`, `compact`, `set_model`, `set_mode`, and thread their `project_id` through `get_state(db, project_id)` / `store.*(…, project_id=project_id)`. (Default 0 keeps General behavior.)

In the `stream` generator, after `state = get_state(db, project_id)` and building `msgs = store.thread_messages(db, project_id)`, change the agent branch:
```python
            if kind == "escalate" or tier == "agent":
                proj = db.get(Project, project_id) if project_id else None
                cwd = proj.repo_path if (proj and proj.repo_path) else None
                prompt = "\n\n".join(f"{m['role']}: {m['content']}" for m in msgs)
                context = f"{load_persona()}\n\n{_build_context(db)}"
                if proj and proj.repo_path:
                    context += "\n\n" + _notion_instructions(proj)
                for ev in _agent_stream(prompt, context=context, session_id=state.agent_session_id or None, cwd=cwd):
                    if ev["type"] == "session":
                        state.agent_session_id = ev["session_id"]; db.commit(); continue
                    if ev["type"] == "text":
                        assistant_text += ev["text"]
                    elif ev["type"] == "todos":
                        todos = ev["todos"]
                    yield _sse(ev)
                if proj and not proj.notion_url:
                    mm = re.search(r"NOTION_URL:\s*(\S+)", assistant_text)
                    if mm:
                        proj.notion_url = mm.group(1); db.commit()
                assistant_text = re.sub(r"\n?NOTION_URL:\s*\S+", "", assistant_text).strip()
```
Persist the assistant turn with `project_id`: `store.add_turn(db, "assistant", assistant_text, tier=tier, project_id=project_id)` (and the user turn likewise at the top of the generator).

> Note: the `NOTION_URL:` line still streams live to the client this turn; it's stripped from the stored history. Acceptable for MVP.

- [ ] **Step 4: Run → pass;** then full suite.
- [ ] **Step 5: Commit:** `... -m "feat(chat): per-project stream scoping + Notion doc-log wiring"`

---

### Task 8: Frontend — project switcher

**Files:** Modify `web/lib/api.ts`, `web/components/chat/ChatPanel.tsx`

- [ ] **Step 1: api.ts** — add to the `projects` usage (or create a `projects` client) :
```typescript
export const projectsApi = {
  list: () => api.get<any[]>("/api/projects"),
  discover: () => api.get<{ name: string; path: string }[]>("/api/projects/discover"),
  setRepoPath: (id: number, repo_path: string) => api.patch<any>(`/api/projects/${id}`, { repo_path }),
};
```
Extend the `chat` client methods to accept an optional `projectId` appended as `?project_id=`:
```typescript
  thread: (projectId = 0) => api.get<ChatThread>(`/api/chat/thread?project_id=${projectId}`),
  setTier: (tier: string, projectId = 0) => api.post<{tier:string}>(`/api/chat/model?project_id=${projectId}`, { tier }),
  setMode: (mode: string, projectId = 0) => api.post<{mode:string}>(`/api/chat/mode?project_id=${projectId}`, { mode }),
  compact: (projectId = 0) => api.post<{summary:string}>(`/api/chat/compact?project_id=${projectId}`, {}),
  // stream: add projectId arg → fetch(`/api/chat/stream?project_id=${projectId}`, …)
```
(Thread the `projectId` through `chat.stream` too.)

- [ ] **Step 2: ChatPanel.tsx** — add a project dropdown in the header next to the tier badge:
  - state `const [projectId, setProjectId] = useState(0)` and `const [projects, setProjects] = useState<any[]>([])`; load via `projectsApi.list()` on mount.
  - dropdown options: `General` (0) + each project (mark those without `repo_path` as "(set path)"); on change → `setProjectId`, reload `chat.thread(projectId)`, reset local state.
  - all chat calls in the panel pass `projectId`.
  - an "Add project" affordance: a small inline panel that calls `projectsApi.discover()` to list repos (click → `setRepoPath(project, path)` after choosing/creating a project) or a paste-path input. (Keep minimal; match existing styles.)

- [ ] **Step 3: Typecheck:** `cd web; npx tsc --noEmit` → clean.
- [ ] **Step 4: Commit:** `... -m "feat(chat): project switcher (workspaces)"`

---

### Final verification

- [ ] Full suite: `& ".\.venv\Scripts\python.exe" -m pytest -q` → green.
- [ ] Frontend: `cd web; npx tsc --noEmit` → clean.
- [ ] Restart backend (repo root) + frontend.
- [ ] **Manual e2e:** add a project, set its `repo_path` to a real repo, switch to it in the chat, `/model agent`, ask for a tiny change → confirm it edits files in *that* repo and creates/updates a Notion child page under the JARVIS parent (and never the parent). Switch back to General → its thread is separate.
- [ ] Dispatch the final reviewer, then Phase 2b (manager rollup + auto-compaction) as its own spec.

## Notes for the implementer

- General (`project_id = 0`) must behave exactly as Phase 1 — all defaults are `0`.
- Don't remove key-stripping; agent stays on Max plan.
- Notion tool tokens and the parent id are confirmed (Global Constraints) — use them verbatim.
- Keep the parent-protection sentence in `_notion_instructions` verbatim.
