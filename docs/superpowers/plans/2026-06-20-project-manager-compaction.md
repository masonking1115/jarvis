# Phase 2b — Manager Rollup & Auto-Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give General JARVIS a local cross-project status rollup and auto-summarize long per-project chat threads (≥50k est. tokens), with compaction writing each project's manager-facing status.

**Architecture:** Add `status_summary` + `last_active_at` to `Project`. Add token estimation and an auto-compaction helper to the chat `store` that reuses the existing `compact()` + `_summarize()` machinery and writes `Project.status_summary`. Hook it into `/stream` after the assistant turn; inject a `## Projects` rollup into `_build_context`; surface `status_summary` via `ProjectOut` and the dashboard.

**Tech Stack:** FastAPI + SQLAlchemy (SQLite, lightweight additive migrations), Next.js/React + TypeScript.

**Run the suite with:** `& ".\.venv\Scripts\python.exe" -m pytest -q` (plain `python` is Conda and lacks FastAPI). Typecheck frontend with `cd web; npx tsc --noEmit`.

---

### Task 1: Project columns + migration

**Files:**
- Modify: `backend/modules/projects/models.py`
- Modify: `backend/core/db.py:103` (the `"projects"` entry in `additions`)
- Test: `tests/test_manager_compaction.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_manager_compaction.py`:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from datetime import datetime
from backend.core.db import Base
import backend.modules.projects.models  # register
import backend.modules.chat.models      # register


def _db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def test_project_has_status_fields():
    from backend.modules.projects.models import Project
    db = _db()
    p = Project(name="X", status_summary="did a thing", last_active_at=datetime(2026, 6, 20))
    db.add(p); db.commit(); db.refresh(p)
    got = db.get(Project, p.id)
    assert got.status_summary == "did a thing"
    assert got.last_active_at == datetime(2026, 6, 20)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_manager_compaction.py::test_project_has_status_fields -v`
Expected: FAIL — `TypeError: 'status_summary' is an invalid keyword argument for Project`.

- [ ] **Step 3: Add the columns**

In `backend/modules/projects/models.py`, add inside `class Project` (after `created_at`):

```python
    status_summary: Mapped[str | None] = mapped_column(String(2000), default=None)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
```

(`datetime` and `DateTime` are already imported.)

- [ ] **Step 4: Add the migration**

In `backend/core/db.py`, change the `"projects"` line in the `additions` dict (currently line ~103):

```python
        "projects": [
            ("repo_path", "VARCHAR(500)"),
            ("status_summary", "VARCHAR(2000)"),
            ("last_active_at", "DATETIME"),
        ],
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_manager_compaction.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/projects/models.py backend/core/db.py tests/test_manager_compaction.py
git commit -m "feat(projects): add status_summary + last_active_at columns"
```

---

### Task 2: compact_token_threshold setting

**Files:**
- Modify: `backend/core/config.py:26` (after `agent_max_turns`)
- Test: `tests/test_manager_compaction.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_manager_compaction.py`:

```python
def test_compact_threshold_default():
    from backend.core.config import settings
    assert settings.compact_token_threshold == 50_000
```

- [ ] **Step 2: Run it to verify it fails**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_manager_compaction.py::test_compact_threshold_default -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'compact_token_threshold'`.

- [ ] **Step 3: Add the setting**

In `backend/core/config.py`, after the `agent_max_turns` line:

```python
    compact_token_threshold: int = 50_000  # est. tokens (chars/4) before a thread auto-compacts
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_manager_compaction.py::test_compact_threshold_default -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/core/config.py tests/test_manager_compaction.py
git commit -m "feat(config): add compact_token_threshold (50k)"
```

---

### Task 3: estimate_tokens helper

**Files:**
- Modify: `backend/modules/chat/store.py`
- Test: `tests/test_manager_compaction.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_manager_compaction.py`:

```python
def test_estimate_tokens():
    from backend.modules.chat import store
    db = _db()
    assert store.estimate_tokens(db, 7) == 0           # empty thread
    store.add_turn(db, "user", "x" * 40, project_id=7)
    store.add_turn(db, "assistant", "y" * 40, project_id=7)
    assert store.estimate_tokens(db, 7) == 20           # 80 chars // 4
```

- [ ] **Step 2: Run it to verify it fails**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_manager_compaction.py::test_estimate_tokens -v`
Expected: FAIL — `AttributeError: module 'backend.modules.chat.store' has no attribute 'estimate_tokens'`.

- [ ] **Step 3: Implement**

In `backend/modules/chat/store.py`, add after `thread_messages`:

```python
def estimate_tokens(db, project_id: int = 0) -> int:
    """Rough token count for the thread (chars/4 over turns + any compaction summary)."""
    return sum(len(m["content"]) for m in thread_messages(db, project_id)) // 4
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_manager_compaction.py::test_estimate_tokens -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/modules/chat/store.py tests/test_manager_compaction.py
git commit -m "feat(chat): estimate_tokens for a thread"
```

---

### Task 4: compact_with_status + maybe_autocompact

**Files:**
- Modify: `backend/modules/chat/store.py`
- Test: `tests/test_manager_compaction.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_manager_compaction.py`:

```python
def test_compact_with_status_writes_project_summary():
    from backend.modules.chat import store
    from backend.modules.projects.models import Project
    db = _db()
    p = Project(name="Demo"); db.add(p); db.commit()
    store.add_turn(db, "user", "hello", project_id=p.id)
    store.compact_with_status(db, "the summary", p.id)
    assert db.get(Project, p.id).status_summary == "the summary"
    from backend.modules.chat.models import get_state
    assert get_state(db, p.id).compaction_summary == "the summary"
    assert store.load_turns(db, p.id) == []                  # turns cleared


def test_maybe_autocompact_threshold():
    from backend.modules.chat import store
    from backend.modules.projects.models import Project
    db = _db()
    p = Project(name="Demo"); db.add(p); db.commit()
    calls = {"n": 0}
    def fake_sum(msgs): calls["n"] += 1; return "SUM"

    store.add_turn(db, "user", "short", project_id=p.id)
    assert store.maybe_autocompact(db, p.id, fake_sum) is False   # under threshold
    assert calls["n"] == 0

    store.add_turn(db, "assistant", "z" * 250_000, project_id=p.id)  # >50k tokens
    assert store.maybe_autocompact(db, p.id, fake_sum) is True
    assert db.get(Project, p.id).status_summary == "SUM"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_manager_compaction.py -k "compact_with_status or maybe_autocompact" -v`
Expected: FAIL — attributes don't exist yet.

- [ ] **Step 3: Implement**

In `backend/modules/chat/store.py`, add `from backend.core.config import settings` to the imports at the top, then add after `compact`:

```python
def compact_with_status(db, summary: str, project_id: int = 0) -> None:
    """Compact the thread and, for a real project, store the summary as its
    manager-facing status_summary."""
    compact(db, summary, project_id)
    if project_id:
        from backend.modules.projects.models import Project
        proj = db.get(Project, project_id)
        if proj:
            proj.status_summary = summary
            db.commit()


def maybe_autocompact(db, project_id: int, summarize) -> bool:
    """If the thread is over the token threshold, summarize + compact it.
    `summarize(messages) -> str` is injected so this stays unit-testable."""
    if estimate_tokens(db, project_id) < settings.compact_token_threshold:
        return False
    summary = (summarize(thread_messages(db, project_id)) or "").strip()
    if not summary:
        return False
    compact_with_status(db, summary, project_id)
    return True
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_manager_compaction.py -v`
Expected: PASS (all of them).

- [ ] **Step 5: Commit**

```bash
git add backend/modules/chat/store.py tests/test_manager_compaction.py
git commit -m "feat(chat): compact_with_status + maybe_autocompact"
```

---

### Task 5: /compact writes status; /stream bumps last_active + auto-compacts

**Files:**
- Modify: `backend/modules/chat/router.py` (`compact` handler ~line 230; `/stream` `gen()` ~line 333)
- Test: `tests/test_chat_stream_endpoint.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_chat_stream_endpoint.py`:

```python
def test_stream_bumps_last_active_and_autocompacts(ctx, monkeypatch):
    client, TS = ctx
    from backend.modules.projects.models import Project
    from backend.modules.chat import store
    db = TS(); proj = Project(name="Demo", repo_path="."); db.add(proj); db.commit(); pid = proj.id
    # Pre-fill a huge thread so the post-turn estimate is over threshold.
    store.add_turn(db, "assistant", "z" * 250_000, project_id=pid)
    monkeypatch.setattr(cr.service, "plan",
        lambda db, msgs, skill=None, tier=None, extra_context=None: {"kind": "reply", "text": "ok"})
    monkeypatch.setattr(cr, "_summarize", lambda msgs: "ROLLUP")

    r = client.post(f"/api/chat/stream?project_id={pid}", json={"text": "hi"})
    assert r.status_code == 200
    saved = TS().get(Project, pid)
    assert saved.last_active_at is not None        # bumped
    assert saved.status_summary == "ROLLUP"        # auto-compacted → status written
```

- [ ] **Step 2: Run it to verify it fails**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_chat_stream_endpoint.py::test_stream_bumps_last_active_and_autocompacts -v`
Expected: FAIL — `last_active_at` is None (no bump yet).

- [ ] **Step 3: Update the `/compact` handler**

In `backend/modules/chat/router.py`, change the body of `compact` (the `@router.post("/compact")` function) from `store.compact(db, summary, project_id)` to:

```python
    store.compact_with_status(db, summary, project_id)
```

- [ ] **Step 4: Update `/stream` to bump + auto-compact**

In `backend/modules/chat/router.py`, find the line `store.add_turn(db, "assistant", assistant_text, tier=tier, project_id=project_id)` (~line 333, inside `gen()`'s `try`). Replace it with:

```python
            store.add_turn(db, "assistant", assistant_text, tier=tier, project_id=project_id)
            if project_id:
                proj_t = db.get(Project, project_id)
                if proj_t:
                    proj_t.last_active_at = datetime.utcnow(); db.commit()
            try:
                store.maybe_autocompact(db, project_id, _summarize)
            except Exception:  # noqa: BLE001 — best-effort; response already sent
                pass
```

(`datetime` is already imported at the top of the file.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_chat_stream_endpoint.py -v`
Expected: PASS (new test + all existing stream tests).

- [ ] **Step 6: Commit**

```bash
git add backend/modules/chat/router.py tests/test_chat_stream_endpoint.py
git commit -m "feat(chat): bump last_active_at + auto-compact after turn; /compact writes status"
```

---

### Task 6: ## Projects rollup in _build_context

**Files:**
- Modify: `backend/modules/chat/router.py` (`_build_context` ~lines 96-144; imports ~line 20)
- Test: `tests/test_chat_context.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_chat_context.py`:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from backend.core.db import Base
import backend.modules.projects.models  # noqa: F401
import backend.modules.chat.models      # noqa: F401


def _db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def test_build_context_lists_projects():
    import backend.modules.chat.router as cr
    from backend.modules.projects.models import Project
    from backend.modules.chat import store
    db = _db()
    a = Project(name="Alpha", status_summary="shipped the parser"); db.add(a)
    b = Project(name="Beta"); db.add(b); db.commit()
    store.add_turn(db, "assistant", "beta latest progress note", project_id=b.id)

    ctx = cr._build_context(db)
    assert "## Projects" in ctx
    assert "Alpha" in ctx and "shipped the parser" in ctx          # uses status_summary
    assert "Beta" in ctx and "beta latest progress note" in ctx    # falls back to turn snippet


def test_build_context_excludes_done_projects():
    import backend.modules.chat.router as cr
    from backend.modules.projects.models import Project
    db = _db()
    db.add(Project(name="Finished", status="done", status_summary="all done")); db.commit()
    assert "Finished" not in cr._build_context(db)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_chat_context.py -v`
Expected: FAIL — no `## Projects` section.

- [ ] **Step 3: Import ChatTurn**

In `backend/modules/chat/router.py`, change the import line `from backend.modules.chat.models import get_state` to:

```python
from backend.modules.chat.models import get_state, ChatTurn
```

- [ ] **Step 4: Append the rollup in `_build_context`**

In `_build_context`, immediately before the `facts = profile_storage.get_context(db)` line (near the end, ~line 141), insert:

```python
    # Projects rollup (manager view): each non-done project's latest status, so
    # General JARVIS can answer "what's happening across my projects?" locally.
    proj_rows = (db.query(Project).filter(Project.status != "done")
                 .order_by(Project.last_active_at.desc()).limit(12).all())
    if proj_rows:
        lines += ["", "## Projects"]
        for p in proj_rows:
            la = f" — last active {p.last_active_at.date()}" if p.last_active_at else ""
            lines.append(f"- {p.name} ({p.status}){la}")
            summary = p.status_summary
            if not summary:
                last = (db.query(ChatTurn)
                        .filter(ChatTurn.project_id == p.id, ChatTurn.role == "assistant")
                        .order_by(ChatTurn.id.desc()).first())
                summary = (last.content[:200] + "…") if last and last.content else ""
            if summary:
                lines.append(f"  {summary}")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_chat_context.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/chat/router.py tests/test_chat_context.py
git commit -m "feat(chat): inject ## Projects manager rollup into context"
```

---

### Task 7: ProjectOut exposes the new fields

**Files:**
- Modify: `backend/modules/projects/schemas.py:27-30`
- Test: `tests/test_projects_api.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_projects_api.py`:

```python
from datetime import datetime
from backend.modules.projects.schemas import ProjectOut


def test_projectout_has_status_fields():
    fields = ProjectOut.model_fields
    assert "status_summary" in fields and "last_active_at" in fields


def test_projectout_serializes_from_model():
    from types import SimpleNamespace
    obj = SimpleNamespace(id=1, name="X", status="active", progress=0.0,
                          notion_url=None, notes=None, repo_path=None,
                          created_at=datetime(2026, 6, 20),
                          status_summary="rollup", last_active_at=datetime(2026, 6, 20))
    out = ProjectOut.model_validate(obj)
    assert out.status_summary == "rollup"
    assert out.last_active_at == datetime(2026, 6, 20)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_projects_api.py -v`
Expected: FAIL — fields absent from `ProjectOut`.

- [ ] **Step 3: Add the fields to ProjectOut**

In `backend/modules/projects/schemas.py`, update `ProjectOut`:

```python
class ProjectOut(ProjectBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    status_summary: str | None = None
    last_active_at: datetime | None = None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_projects_api.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `& ".\.venv\Scripts\python.exe" -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/projects/schemas.py tests/test_projects_api.py
git commit -m "feat(projects): expose status_summary + last_active_at in ProjectOut"
```

---

### Task 8: Frontend Project type

**Files:**
- Modify: `web/lib/api.ts:38`

- [ ] **Step 1: Extend the type**

In `web/lib/api.ts`, change the `Project` type (line 38) to add the two fields before `created_at`:

```typescript
export type Project = { id: number; name: string; status: string; progress: number; notion_url: string|null; notes: string|null; repo_path: string|null; status_summary: string|null; last_active_at: string|null; created_at: string };
```

- [ ] **Step 2: Typecheck**

Run: `cd web; npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add web/lib/api.ts
git commit -m "feat(web): add status_summary + last_active_at to Project type"
```

---

### Task 9: Dashboard shows status_summary

**Files:**
- Modify: `web/app/(console)/dashboard/page.tsx` (`ProjectsBlock`, ~lines 320-333)

- [ ] **Step 1: Add a status line under each project row**

In `ProjectsBlock`, change the returned `<li>` (currently lines 321-332) so the row and an optional status line stack vertically:

```tsx
        return (
          <li key={p.id} className="text-[13px]">
            {p.notion_url ? (
              <a href={p.notion_url} target="_blank" rel="noreferrer"
                 className="flex items-center gap-3 hover:bg-white/[0.03] rounded-md -mx-1 px-1 py-0.5 transition-colors">
                {inner}
              </a>
            ) : (
              <div className="flex items-center gap-3" title="No Notion page linked yet">
                {inner}
              </div>
            )}
            {p.status_summary && (
              <p className="mt-0.5 text-[11px] leading-snug text-jarvis-muted line-clamp-2">
                {p.status_summary}
              </p>
            )}
          </li>
        );
```

- [ ] **Step 2: Typecheck**

Run: `cd web; npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(console)/dashboard/page.tsx"
git commit -m "feat(web): show project status_summary on the dashboard"
```

---

### Task 10: Full verification + push

- [ ] **Step 1: Backend suite**

Run: `& ".\.venv\Scripts\python.exe" -m pytest -q`
Expected: all pass (existing + the new manager/compaction/context/projects tests).

- [ ] **Step 2: Frontend typecheck**

Run: `cd web; npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Push**

```bash
git push origin main
```
