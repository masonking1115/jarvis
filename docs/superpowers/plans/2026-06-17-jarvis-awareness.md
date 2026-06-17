# JARVIS Awareness & Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give JARVIS a persistent, growing store of facts about the user that he learns from conversation (auto + explicit), surfaces in every reply and the action planner, and lets the user review/correct.

**Architecture:** A new auto-mounting `profile` module owns a `UserFact` SQLite table with a storage layer (CRUD + `get_context`) and a background LLM extractor. Recall is injected into the chat prompt and the previously-blind agent planner; capture runs as a non-blocking `BackgroundTask` after chat/voice turns. A new Profile tab provides CRUD over facts.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (`Mapped[]`), SQLite, Next.js 14 App Router, Tailwind, pytest.

**Reference (read before starting):**
- Module pattern: `backend/modules/tax/{__init__,models,router}.py`
- Model registration: `backend/core/db.py::init_db` (explicit per-module imports)
- Auto-mount: `backend/core/registry.py` (any `__init__.py` exposing `router` mounts at `/api/<name>`)
- LLM provider + robust JSON parse: `backend/core/llm.py`, `backend/modules/agent/service.py::_parse`
- Recall injection targets: `backend/modules/chat/router.py::_build_context`, `backend/modules/agent/service.py::plan`
- Test style: `tests/test_agent.py` (monkeypatched provider; this plan adds an in-memory SQLite fixture for real CRUD)
- Frontend nav: `web/components/Sidebar.tsx`; client helpers: `web/lib/api.ts`; page pattern: `web/app/(console)/finance/page.tsx`

---

### Task 1: UserFact model + DB registration

**Files:**
- Create: `backend/modules/profile/__init__.py`
- Create: `backend/modules/profile/models.py`
- Modify: `backend/core/db.py` (add model import in `init_db`)
- Test: `tests/test_profile.py`

- [ ] **Step 1: Create the package `__init__.py`** (placeholder — router.py is created in Task 4)

The real `__init__.py` (`from .router import router`) is written in Task 4 Step 4. For now, create a placeholder so the package imports cleanly (the model-registration import in `init_db` and the test fixture both import this package). Create exactly:

`backend/modules/profile/__init__.py`:
```python
# placeholder until router.py exists (replaced in Task 4)
router = None
```

- [ ] **Step 2: Write the model**

`backend/modules/profile/models.py`:
```python
from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class UserFact(Base):
    """One discrete thing JARVIS knows about the user.

    Facts accumulate over time (auto-extracted from conversation or stated
    explicitly), are injected into chat + the action planner, and are managed
    by the user on the Profile page. "Forgetting" is a soft delete (status).
    Local-only; never sent anywhere without explicit user confirmation.
    """
    __tablename__ = "user_facts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(32), default="other", index=True)
    # preference | goal | routine | relationship | context | dislike | other
    content: Mapped[str] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(16), default="inferred")   # explicit | inferred
    confidence: Mapped[float] = mapped_column(Float, default=0.7)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)  # active | archived
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 3: Register the model in `init_db`**

In `backend/core/db.py`, inside `init_db()`, add the import alongside the existing per-module imports (after the `_flyover_models` line):
```python
    from backend.modules.flyover import models as _flyover_models  # noqa: F401
    from backend.modules.profile import models as _profile_models  # noqa: F401
```

- [ ] **Step 4: Write the failing test (model + in-memory fixture)**

`tests/test_profile.py`:
```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.db import Base
from backend.modules.profile import models  # noqa: F401 — registers UserFact on Base.metadata
from backend.modules.profile.models import UserFact


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[UserFact.__table__])
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    s = Session()
    try:
        yield s
    finally:
        s.close()


def test_userfact_defaults(db):
    f = UserFact(content="Prefers morning workouts")
    db.add(f); db.commit(); db.refresh(f)
    assert f.id is not None
    assert f.category == "other"
    assert f.source == "inferred"
    assert f.status == "active"
    assert f.pinned is False
    assert 0.0 <= f.confidence <= 1.0
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `python -m pytest tests/test_profile.py -v`
Expected: `test_userfact_defaults PASSED`

- [ ] **Step 6: Commit**

```bash
git add backend/modules/profile/__init__.py backend/modules/profile/models.py backend/core/db.py tests/test_profile.py
git commit -m "feat(profile): UserFact model + db registration"
```

---

### Task 2: Storage layer (CRUD + get_context)

**Files:**
- Create: `backend/modules/profile/storage.py`
- Test: `tests/test_profile.py` (extend)

- [ ] **Step 1: Write failing tests**

Append to `tests/test_profile.py`:
```python
from backend.modules.profile import storage


def test_create_and_list(db):
    storage.create_fact(db, category="goal", content="Max out 401k", source="explicit", confidence=1.0)
    storage.create_fact(db, category="preference", content="Likes espresso")
    facts = storage.list_facts(db)
    assert len(facts) == 2


def test_archive_hides_from_list(db):
    f = storage.create_fact(db, category="other", content="temp")
    assert storage.archive_fact(db, f.id) is True
    assert storage.list_facts(db) == []
    assert len(storage.list_facts(db, include_archived=True)) == 1


def test_update_fact(db):
    f = storage.create_fact(db, category="preference", content="Likes tea")
    out = storage.update_fact(db, f.id, content="Likes coffee", pinned=True)
    assert out.content == "Likes coffee"
    assert out.pinned is True


def test_get_context_orders_pinned_then_confidence(db):
    storage.create_fact(db, category="other", content="low", confidence=0.3)
    storage.create_fact(db, category="other", content="high", confidence=0.9)
    storage.create_fact(db, category="goal", content="pinned", confidence=0.1, pinned=True)
    ctx = storage.get_context(db)
    lines = [l for l in ctx.splitlines() if l.startswith("- ")]
    assert "pinned" in lines[0]      # pinned first regardless of confidence
    assert "high" in lines[1]        # then by confidence desc
    assert "low" in lines[2]


def test_get_context_empty_is_blank(db):
    assert storage.get_context(db) == ""
```

- [ ] **Step 2: Run — verify failure**

Run: `python -m pytest tests/test_profile.py -v -k "create or archive or update or get_context"`
Expected: FAIL with `AttributeError: module 'backend.modules.profile.storage' has no attribute ...` (file doesn't exist yet)

- [ ] **Step 3: Implement the storage layer**

`backend/modules/profile/storage.py`:
```python
from __future__ import annotations
from datetime import datetime
from sqlalchemy.orm import Session
from .models import UserFact

_ALLOWED = {"category", "content", "source", "confidence", "status", "pinned"}


def create_fact(db: Session, *, category: str = "other", content: str,
                source: str = "inferred", confidence: float = 0.7,
                pinned: bool = False) -> UserFact:
    f = UserFact(category=category, content=content.strip(), source=source,
                 confidence=confidence, pinned=pinned)
    db.add(f); db.commit(); db.refresh(f)
    return f


def list_facts(db: Session, include_archived: bool = False) -> list[UserFact]:
    q = db.query(UserFact)
    if not include_archived:
        q = q.filter(UserFact.status == "active")
    # pinned first, then confidence desc, then most-recent
    return q.order_by(UserFact.pinned.desc(), UserFact.confidence.desc(),
                      UserFact.created_at.desc()).all()


def get_fact(db: Session, fact_id: int) -> UserFact | None:
    return db.get(UserFact, fact_id)


def update_fact(db: Session, fact_id: int, **fields) -> UserFact | None:
    f = db.get(UserFact, fact_id)
    if not f:
        return None
    for k, v in fields.items():
        if k in _ALLOWED and v is not None:
            setattr(f, k, v)
    f.updated_at = datetime.utcnow()
    db.commit(); db.refresh(f)
    return f


def archive_fact(db: Session, fact_id: int) -> bool:
    f = db.get(UserFact, fact_id)
    if not f:
        return False
    f.status = "archived"; f.updated_at = datetime.utcnow()
    db.commit()
    return True


def get_context(db: Session, cap: int = 50) -> str:
    """Compact block of active facts for the system prompt. Empty if no facts."""
    facts = list_facts(db)[:cap]
    if not facts:
        return ""
    lines = ["# What you know about the user"]
    for f in facts:
        tag = f.category
        meta = "explicit" if f.source == "explicit" else f"inferred, {f.confidence:.1f}"
        lines.append(f"- [{tag}] {f.content} ({meta})")
    return "\n".join(lines)
```

- [ ] **Step 4: Run — verify pass**

Run: `python -m pytest tests/test_profile.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/modules/profile/storage.py tests/test_profile.py
git commit -m "feat(profile): storage CRUD + get_context renderer"
```

---

### Task 3: Background fact extractor

**Files:**
- Create: `backend/modules/profile/extract.py`
- Test: `tests/test_profile.py` (extend)

- [ ] **Step 1: Write failing tests**

Append to `tests/test_profile.py`:
```python
from backend.modules.profile import extract as extract_mod


class _Provider:
    """Stub LLM returning a fixed JSON action list."""
    name = "stub"
    def __init__(self, payload): self.payload = payload
    def chat(self, system, messages, model=None): return self.payload


def test_extract_adds_new_fact(db, monkeypatch):
    payload = '[{"action":"add","category":"goal","content":"Run a marathon","confidence":0.8,"source":"inferred"}]'
    monkeypatch.setattr(extract_mod, "get_provider", lambda o=None: _Provider(payload))
    extract_mod.extract_and_store(db, "I want to run a marathon someday", "Noted, sir.")
    facts = storage.list_facts(db)
    assert len(facts) == 1 and facts[0].content == "Run a marathon"


def test_extract_updates_existing(db, monkeypatch):
    f = storage.create_fact(db, category="preference", content="Prefers morning workouts")
    payload = f'[{{"action":"update","id":{f.id},"category":"preference","content":"Prefers evening workouts","confidence":0.9}}]'
    monkeypatch.setattr(extract_mod, "get_provider", lambda o=None: _Provider(payload))
    extract_mod.extract_and_store(db, "actually I train at night now", "Understood, sir.")
    assert storage.get_fact(db, f.id).content == "Prefers evening workouts"


def test_extract_archives(db, monkeypatch):
    f = storage.create_fact(db, category="goal", content="Buy a boat")
    payload = f'[{{"action":"archive","id":{f.id}}}]'
    monkeypatch.setattr(extract_mod, "get_provider", lambda o=None: _Provider(payload))
    extract_mod.extract_and_store(db, "I no longer want a boat", "Very good, sir.")
    assert storage.list_facts(db) == []


def test_extract_garbage_writes_nothing(db, monkeypatch):
    monkeypatch.setattr(extract_mod, "get_provider", lambda o=None: _Provider("not json at all"))
    extract_mod.extract_and_store(db, "hello", "Good day, sir.")
    assert storage.list_facts(db) == []


def test_extract_swallows_provider_error(db, monkeypatch):
    class Boom:
        name = "boom"
        def chat(self, *a, **k): raise RuntimeError("cli down")
    monkeypatch.setattr(extract_mod, "get_provider", lambda o=None: Boom())
    # must not raise
    extract_mod.extract_and_store(db, "x", "y")
    assert storage.list_facts(db) == []
```

- [ ] **Step 2: Run — verify failure**

Run: `python -m pytest tests/test_profile.py -v -k extract`
Expected: FAIL (`extract.py` missing)

- [ ] **Step 3: Implement the extractor**

`backend/modules/profile/extract.py`:
```python
"""Background fact extraction: turn a conversation turn into UserFact changes."""
from __future__ import annotations

import json
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.llm import get_provider
from . import storage

_INSTRUCTION = (
    "You maintain a long-term memory of durable facts about ONE user.\n"
    "Given the latest conversation turn and the user's CURRENT known facts, "
    "decide what to change. Capture stable things about the user: their goals, "
    "preferences, routines, relationships, situation, dislikes. If the user "
    "explicitly says to remember something, set source to \"explicit\".\n"
    "RULES:\n"
    "- Never store secrets, passwords, API keys, or credential-file contents.\n"
    "- Ignore transient chatter (e.g. 'what's the weather'); store nothing for it.\n"
    "- Do not duplicate an existing fact; update it instead. Archive a fact only "
    "when the user contradicts/retracts it.\n"
    "Respond with ONLY a JSON array (no prose, no code fences). Each item:\n"
    '{"action":"add","category":"goal|preference|routine|relationship|context|dislike|other",'
    '"content":"...","confidence":0.0-1.0,"source":"inferred|explicit"}\n'
    '{"action":"update","id":<existing id>,"category":"...","content":"...","confidence":0.0-1.0}\n'
    '{"action":"archive","id":<existing id>}\n'
    "Return [] if nothing is worth saving."
)


def _render_existing(db: Session) -> str:
    facts = storage.list_facts(db)
    if not facts:
        return "(no facts yet)"
    return "\n".join(f"#{f.id} [{f.category}] {f.content}" for f in facts)


def _parse(raw: str) -> list[dict]:
    s = (raw or "").strip()
    if "```" in s:
        parts = s.split("```")
        s = parts[1] if len(parts) >= 2 else s.replace("```", "")
        if s.lower().startswith("json"):
            s = s[4:]
        s = s.strip()
    i, j = s.find("["), s.rfind("]")
    if i == -1 or j == -1 or j <= i:
        return []
    try:
        obj = json.loads(s[i:j + 1])
        return obj if isinstance(obj, list) else []
    except Exception:  # noqa: BLE001
        return []


def _apply(db: Session, items: list[dict]) -> None:
    for it in items:
        if not isinstance(it, dict):
            continue
        action = it.get("action")
        if action == "add" and it.get("content"):
            storage.create_fact(
                db,
                category=it.get("category", "other"),
                content=str(it["content"]),
                source=it.get("source", "inferred"),
                confidence=float(it.get("confidence", 0.7)),
            )
        elif action == "update" and it.get("id") is not None:
            storage.update_fact(
                db, int(it["id"]),
                category=it.get("category"),
                content=it.get("content"),
                confidence=(float(it["confidence"]) if it.get("confidence") is not None else None),
            )
        elif action == "archive" and it.get("id") is not None:
            storage.archive_fact(db, int(it["id"]))


def extract_and_store(db: Session, user_msg: str, assistant_msg: str) -> None:
    """Extract fact changes from one turn and persist them. Never raises."""
    try:
        provider = get_provider()
        system = _INSTRUCTION + "\n\nCURRENT FACTS:\n" + _render_existing(db)
        turn = f"USER: {user_msg}\nASSISTANT: {assistant_msg}"
        raw = provider.chat(system=system, messages=[{"role": "user", "content": turn}],
                            model=settings.voice_model)
        _apply(db, _parse(raw))
    except Exception:  # noqa: BLE001 — background task must never surface errors
        return


def extract_in_background(user_msg: str, assistant_msg: str) -> None:
    """Entry point for FastAPI BackgroundTasks: owns its own DB session."""
    from backend.core.db import SessionLocal
    db = SessionLocal()
    try:
        extract_and_store(db, user_msg, assistant_msg)
    finally:
        db.close()
```

- [ ] **Step 4: Run — verify pass**

Run: `python -m pytest tests/test_profile.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/modules/profile/extract.py tests/test_profile.py
git commit -m "feat(profile): background LLM fact extractor (add/update/archive)"
```

---

### Task 4: Profile API endpoints

**Files:**
- Create: `backend/modules/profile/router.py`
- Modify: `backend/modules/profile/__init__.py` (replace placeholder)
- Test: `tests/test_profile.py` (extend)

- [ ] **Step 1: Write failing tests** (call route functions directly with the fixture session)

Append to `tests/test_profile.py`:
```python
import importlib
profile_router = importlib.import_module("backend.modules.profile.router")


def test_endpoint_create_and_list(db):
    profile_router.create(profile_router.FactIn(category="goal", content="Learn piano"), db=db)
    out = profile_router.list_facts(db=db)
    assert out["count"] == 1
    assert out["facts"][0]["content"] == "Learn piano"
    assert out["facts"][0]["source"] == "explicit"   # manual adds are explicit


def test_endpoint_patch_and_delete(db):
    f = storage.create_fact(db, category="other", content="x")
    patched = profile_router.patch(f.id, profile_router.FactPatch(content="y", pinned=True), db=db)
    assert patched["content"] == "y" and patched["pinned"] is True
    res = profile_router.delete(f.id, db=db)
    assert res["ok"] is True
    assert profile_router.list_facts(db=db)["count"] == 0


def test_endpoint_patch_missing_404(db):
    import pytest as _pytest
    from fastapi import HTTPException
    with _pytest.raises(HTTPException):
        profile_router.patch(999, profile_router.FactPatch(content="z"), db=db)
```

- [ ] **Step 2: Run — verify failure**

Run: `python -m pytest tests/test_profile.py -v -k endpoint`
Expected: FAIL (`router.py` has no `create`/`FactIn`)

- [ ] **Step 3: Implement the router**

`backend/modules/profile/router.py`:
```python
"""Profile endpoints (/api/profile): CRUD over what JARVIS knows about the user."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from . import storage
from .models import UserFact

router = APIRouter()


class FactIn(BaseModel):
    category: str = "other"
    content: str


class FactPatch(BaseModel):
    category: str | None = None
    content: str | None = None
    confidence: float | None = None
    pinned: bool | None = None
    status: str | None = None


def _ser(f: UserFact) -> dict:
    return {
        "id": f.id, "category": f.category, "content": f.content,
        "source": f.source, "confidence": f.confidence, "status": f.status,
        "pinned": f.pinned,
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "updated_at": f.updated_at.isoformat() if f.updated_at else None,
    }


@router.get("")
def list_facts(db: Session = Depends(get_db)):
    facts = storage.list_facts(db)
    return {"facts": [_ser(f) for f in facts], "count": len(facts)}


@router.post("")
def create(body: FactIn, db: Session = Depends(get_db)):
    # Manual adds are user-stated → explicit, full confidence.
    f = storage.create_fact(db, category=body.category, content=body.content,
                            source="explicit", confidence=1.0)
    return _ser(f)


@router.patch("/{fact_id}")
def patch(fact_id: int, body: FactPatch, db: Session = Depends(get_db)):
    f = storage.update_fact(db, fact_id, **body.model_dump(exclude_none=True))
    if not f:
        raise HTTPException(status_code=404, detail="fact not found")
    return _ser(f)


@router.delete("/{fact_id}")
def delete(fact_id: int, db: Session = Depends(get_db)):
    if not storage.archive_fact(db, fact_id):
        raise HTTPException(status_code=404, detail="fact not found")
    return {"ok": True}
```

- [ ] **Step 4: Replace the placeholder `__init__.py`**

`backend/modules/profile/__init__.py`:
```python
from .router import router

__all__ = ["router"]
```

- [ ] **Step 5: Run — verify pass**

Run: `python -m pytest tests/test_profile.py -v`
Expected: all PASS

- [ ] **Step 6: Verify the module auto-mounts**

Run: `python -c "from backend.modules.profile import router; print(type(router).__name__)"`
Expected: `APIRouter`

- [ ] **Step 7: Commit**

```bash
git add backend/modules/profile/router.py backend/modules/profile/__init__.py tests/test_profile.py
git commit -m "feat(profile): /api/profile CRUD endpoints"
```

---

### Task 5: Recall — inject facts into chat + planner

**Files:**
- Modify: `backend/modules/chat/router.py` (`_build_context`)
- Modify: `backend/modules/agent/service.py` (`plan`)
- Test: `tests/test_profile.py` (extend)

- [ ] **Step 1: Write failing test for planner injection**

Append to `tests/test_profile.py`:
```python
def test_planner_system_includes_facts(db, monkeypatch):
    from backend.modules.agent import service
    storage.create_fact(db, category="goal", content="Save for a house", source="explicit", confidence=1.0)

    captured = {}
    class P:
        name = "p"
        def chat(self, system, messages, model=None):
            captured["system"] = system
            return '{"kind":"reply","text":"Noted, sir."}'
    monkeypatch.setattr(service, "get_provider", lambda o=None: P())
    service.plan(db, [{"role": "user", "content": "hi"}])
    assert "Save for a house" in captured["system"]
```

- [ ] **Step 2: Run — verify failure**

Run: `python -m pytest tests/test_profile.py -v -k planner_system`
Expected: FAIL (facts not yet in planner system prompt)

- [ ] **Step 3: Inject into the planner**

In `backend/modules/agent/service.py`, add the import near the other module imports at the top:
```python
from backend.modules.profile import storage as profile_storage
```

Then in `plan(...)`, change the `system` assignment to append the fact context. Replace:
```python
    system = load_persona() + "\n\n" + _PLAN_INSTRUCTION.replace("{tools}", registry.render())
```
with:
```python
    facts = profile_storage.get_context(db)
    system = load_persona()
    if facts:
        system += "\n\n" + facts
    system += "\n\n" + _PLAN_INSTRUCTION.replace("{tools}", registry.render())
```

- [ ] **Step 4: Inject into chat context**

In `backend/modules/chat/router.py`, add the import near the other module imports at the top:
```python
from backend.modules.profile import storage as profile_storage
```

Then at the END of `_build_context(db)`, before `return "\n".join(lines)`, add:
```python
    facts = profile_storage.get_context(db)
    if facts:
        lines += ["", facts]
```

- [ ] **Step 5: Run — verify pass**

Run: `python -m pytest tests/test_profile.py -v -k planner_system`
Expected: PASS

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `python -m pytest -q`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add backend/modules/agent/service.py backend/modules/chat/router.py tests/test_profile.py
git commit -m "feat(profile): inject learned facts into chat + action planner"
```

---

### Task 6: Capture — trigger background extraction after turns

**Files:**
- Modify: `backend/modules/agent/router.py` (`plan` endpoint — covers voice/action path)
- Modify: `backend/modules/chat/router.py` (`chat` endpoint — covers typed path)
- Test: `tests/test_profile.py` (extend)

- [ ] **Step 1: Write failing test (agent plan schedules extraction)**

Append to `tests/test_profile.py`:
```python
def test_agent_plan_schedules_extraction(db, monkeypatch):
    import importlib
    from backend.modules.agent import service
    agent_router = importlib.import_module("backend.modules.agent.router")

    class P:
        name = "p"
        def chat(self, system, messages, model=None):
            return '{"kind":"reply","text":"Good day, sir."}'
    monkeypatch.setattr(service, "get_provider", lambda o=None: P())

    scheduled = {}
    class FakeBG:
        def add_task(self, fn, *args):
            scheduled["fn"] = fn; scheduled["args"] = args
    body = agent_router.PlanIn(messages=[agent_router.Msg(role="user", content="remember I like sushi")])
    agent_router.plan(body, background=FakeBG(), db=db)
    assert scheduled["args"][0] == "remember I like sushi"     # user_msg
    assert "sir" in scheduled["args"][1].lower()               # assistant text
```

- [ ] **Step 2: Run — verify failure**

Run: `python -m pytest tests/test_profile.py -v -k schedules_extraction`
Expected: FAIL (`plan()` takes no `background` param)

- [ ] **Step 3: Wire extraction into the agent plan endpoint**

In `backend/modules/agent/router.py`, update imports and the `plan` route. Change:
```python
from fastapi import APIRouter, Depends
```
to:
```python
from fastapi import APIRouter, Depends, BackgroundTasks
```

Add near the top (after `from . import service, registry`):
```python
from backend.modules.profile.extract import extract_in_background
```

Replace the `plan` route with:
```python
@router.post("/plan")
def plan(body: PlanIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    msgs = [{"role": m.role, "content": m.content} for m in body.messages]
    result = service.plan(db, msgs)
    last_user = next((m["content"] for m in reversed(msgs) if m["role"] == "user"), "")
    assistant_text = result.get("text") or result.get("ack") or ""
    if last_user and assistant_text:
        background.add_task(extract_in_background, last_user, assistant_text)
    return result
```

- [ ] **Step 4: Wire extraction into the chat endpoint**

In `backend/modules/chat/router.py`, change:
```python
from fastapi import APIRouter, Depends
```
to:
```python
from fastapi import APIRouter, Depends, BackgroundTasks
```

Add near the other imports:
```python
from backend.modules.profile.extract import extract_in_background
```

Replace the `chat` route signature and end. Change the signature line:
```python
def chat(req: ChatRequest, db: Session = Depends(get_db)):
```
to:
```python
def chat(req: ChatRequest, background: BackgroundTasks, db: Session = Depends(get_db)):
```

And before `return ChatResponse(reply=reply, provider=provider.name)`, add:
```python
    last_user = next((m["content"] for m in reversed(req.messages) if m.role == "user"), "")
    if last_user and reply:
        background.add_task(extract_in_background, last_user, reply)
```

- [ ] **Step 5: Fix the existing voice test for the new `chat` signature**

`tests/test_voice.py::test_chat_voice_flag_tightens_system` calls `chat_router.chat(req, db=FakeDB())` directly, which now needs a `background` argument. Change line 64:
```python
    chat_router.chat(req, db=FakeDB())
```
to:
```python
    class FakeBG:
        def add_task(self, *a, **k): pass
    chat_router.chat(req, background=FakeBG(), db=FakeDB())
```

- [ ] **Step 6: Run — verify pass (new + existing)**

Run: `python -m pytest tests/test_profile.py -v -k schedules_extraction && python -m pytest tests/test_voice.py -v -k voice_flag`
Expected: both PASS

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest -q`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add backend/modules/agent/router.py backend/modules/chat/router.py tests/test_profile.py tests/test_voice.py
git commit -m "feat(profile): schedule background fact extraction after chat + voice turns"
```

---

### Task 7: Proactivity — use facts in briefing + planner

**Files:**
- Modify: `backend/modules/agent/service.py` (`_PLAN_INSTRUCTION`)
- Modify: `backend/modules/chat/router.py` (`daily_briefing` prompt)
- Test: `tests/test_profile.py` (extend)

- [ ] **Step 1: Write failing test**

Append to `tests/test_profile.py`:
```python
def test_plan_instruction_mentions_proactive():
    from backend.modules.agent import service
    assert "goal" in service._PLAN_INSTRUCTION.lower()
    assert "proactive" in service._PLAN_INSTRUCTION.lower()
```

- [ ] **Step 2: Run — verify failure**

Run: `python -m pytest tests/test_profile.py -v -k proactive`
Expected: FAIL

- [ ] **Step 3: Extend the planner instruction**

In `backend/modules/agent/service.py`, append a proactivity line to `_PLAN_INSTRUCTION`. Change the final string line of `_PLAN_INSTRUCTION`:
```python
    "Use an action only when it clearly matches one above; otherwise reply."
```
to:
```python
    "Use an action only when it clearly matches one above; otherwise reply.\n"
    "Be proactive: when the user's known facts and goals are relevant, connect "
    "them to the moment and suggest or take the next concrete step toward a goal "
    "(still confirming anything irreversible first)."
```

- [ ] **Step 4: Extend the briefing prompt**

In `backend/modules/chat/router.py`, in `daily_briefing`, change the `user_msg`:
```python
    user_msg = (
        "Give me a concise morning briefing: top 3 priorities for today based on my tasks and goals, "
        "any deadlines I should know about, and one focused recommendation. Keep it under 200 words."
    )
```
to:
```python
    user_msg = (
        "Give me a concise morning briefing: top 3 priorities for today based on my tasks and goals, "
        "any deadlines I should know about, and one focused recommendation. Where it's relevant, tie "
        "advice to what you know about me (my goals, preferences, routines). Keep it under 200 words."
    )
```

- [ ] **Step 5: Run — verify pass**

Run: `python -m pytest tests/test_profile.py -v -k proactive`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/modules/agent/service.py backend/modules/chat/router.py tests/test_profile.py
git commit -m "feat(profile): proactive, goal-aware planner + briefing prompts"
```

---

### Task 8: Frontend API client

**Files:**
- Modify: `web/lib/api.ts`

- [ ] **Step 1: Add the type + client helpers**

In `web/lib/api.ts`, after the `tax` block (before the Flyover section), add:
```typescript
// ---- Profile (what JARVIS knows about me) ----
export type UserFact = {
  id: number;
  category: string;        // preference | goal | routine | relationship | context | dislike | other
  content: string;
  source: string;          // explicit | inferred
  confidence: number;
  status: string;          // active | archived
  pinned: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export const profile = {
  list:   ()                                  => api.get<{ facts: UserFact[]; count: number }>("/api/profile"),
  add:    (category: string, content: string) => api.post<UserFact>("/api/profile", { category, content }),
  update: (id: number, patch: Partial<Pick<UserFact, "category" | "content" | "confidence" | "pinned" | "status">>) =>
            api.patch<UserFact>(`/api/profile/${id}`, patch),
  remove: (id: number)                        => api.del<{ ok: boolean }>(`/api/profile/${id}`),
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web && npx tsc --noEmit`
Expected: no errors referencing `api.ts`

- [ ] **Step 3: Commit**

```bash
git add web/lib/api.ts
git commit -m "feat(profile): frontend api client + UserFact type"
```

---

### Task 9: Frontend Profile page + nav

**Files:**
- Create: `web/app/(console)/profile/page.tsx`
- Modify: `web/components/Sidebar.tsx` (add nav entry)

- [ ] **Step 1: Add the nav entry**

In `web/components/Sidebar.tsx`, add to the `NAV` array after the `notes` entry:
```typescript
  { href: "/notes",     label: "Notes" },
  { href: "/profile",   label: "Profile" },
  { href: "/settings",  label: "Settings" },
```

- [ ] **Step 2: Create the Profile page**

`web/app/(console)/profile/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { profile, UserFact } from "@/lib/api";

const CATEGORIES = ["preference", "goal", "routine", "relationship", "context", "dislike", "other"];

export default function ProfilePage() {
  const [facts, setFacts] = useState<UserFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCat, setNewCat] = useState("goal");
  const [newContent, setNewContent] = useState("");

  async function load() {
    setLoading(true);
    try { setFacts((await profile.list()).facts); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    const c = newContent.trim();
    if (!c) return;
    await profile.add(newCat, c);
    setNewContent("");
    load();
  }
  async function togglePin(f: UserFact) { await profile.update(f.id, { pinned: !f.pinned }); load(); }
  async function forget(f: UserFact)    { await profile.remove(f.id); load(); }

  const byCategory = CATEGORIES
    .map(cat => ({ cat, items: facts.filter(f => f.category === cat) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl tracking-wider text-jarvis-text mb-1">What JARVIS knows about me</h1>
      <p className="text-jarvis-muted text-sm mb-5">
        Everything JARVIS has learned. Edit, pin, or forget anything — he learns silently as you talk.
      </p>

      <div className="flex gap-2 mb-6">
        <select value={newCat} onChange={e => setNewCat(e.target.value)}
          className="bg-[#040813] border border-jarvis-border rounded px-2 py-2 text-jarvis-text text-sm">
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={newContent} onChange={e => setNewContent(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") add(); }}
          placeholder="Add something JARVIS should know…"
          className="flex-1 bg-[#040813] border border-jarvis-border rounded px-3 py-2 text-jarvis-text text-sm" />
        <button onClick={add}
          className="px-4 py-2 rounded bg-jarvis-accent/20 border border-jarvis-accent text-jarvis-accent text-sm hover:bg-jarvis-accent/30">
          Add
        </button>
      </div>

      {loading ? (
        <p className="text-jarvis-muted">Loading…</p>
      ) : facts.length === 0 ? (
        <p className="text-jarvis-muted">Nothing learned yet. Talk to JARVIS and facts will appear here.</p>
      ) : (
        byCategory.map(({ cat, items }) => (
          <div key={cat} className="mb-6">
            <h2 className="font-ui text-xs tracking-[0.22em] uppercase text-jarvis-accent mb-2">{cat}</h2>
            <ul className="space-y-2">
              {items.map(f => (
                <li key={f.id}
                  className="flex items-center gap-3 border border-jarvis-border rounded px-3 py-2 bg-[#040813]/50">
                  <span className="flex-1 text-jarvis-text text-sm">{f.content}</span>
                  <span className="text-[10px] text-jarvis-muted whitespace-nowrap">
                    {f.source === "explicit" ? "you told me" : `inferred ${Math.round(f.confidence * 100)}%`}
                  </span>
                  <button onClick={() => togglePin(f)} title="Pin"
                    className={`text-xs ${f.pinned ? "text-jarvis-accent" : "text-jarvis-muted hover:text-jarvis-text"}`}>
                    {f.pinned ? "★" : "☆"}
                  </button>
                  <button onClick={() => forget(f)} title="Forget"
                    className="text-xs text-jarvis-muted hover:text-red-400">✕</button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify type-check + the page renders**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

Then, with backend (`uvicorn backend.main:app --reload --port 8000`) and frontend (`npm run dev`) running, open `http://localhost:3000/profile`.
Expected: the page loads, shows "Nothing learned yet" (or existing facts), and Add inserts a fact that persists on reload.

- [ ] **Step 4: Commit**

```bash
git add web/app/(console)/profile/page.tsx web/components/Sidebar.tsx
git commit -m "feat(profile): Profile review page + sidebar nav"
```

---

### Task 10: End-to-end verification

**Files:** none (manual verification)

- [ ] **Step 1: Full backend suite**

Run: `python -m pytest -q`
Expected: all PASS (existing + new `tests/test_profile.py`).

- [ ] **Step 2: Live capture check**

With both servers running, in the typed chat say: "Remember that I prefer morning workouts."
Wait ~30s (background extraction; CLI latency), then reload `http://localhost:3000/profile`.
Expected: a `preference` fact "Prefers morning workouts" (or similar) appears.

- [ ] **Step 3: Live recall check**

In chat ask: "What do you know about my workout preferences?"
Expected: JARVIS references the morning-workout fact (proving recall injection works).

- [ ] **Step 4: Commit any final tweaks** (if needed)

```bash
git add -A
git commit -m "chore(profile): end-to-end verification fixes"
```

---

## Self-Review Notes

**Spec coverage:** UserFact model (Task 1) ✓; hybrid capture — explicit via extractor + manual add (Tasks 3,4), auto-extraction background (Tasks 3,6) ✓; recall into chat + planner (Task 5) ✓; proactive/action-initiating (Task 7, building on existing agent action layer) ✓; review page CRUD + Profile tab (Tasks 4,8,9) ✓; privacy/no-secrets (extractor prompt, Task 3) ✓; resilience/swallow errors (Task 3) ✓; testing (every backend task) ✓.

**Out of scope (per spec):** dedicated chat UI, vector retrieval, API-key latency fix — intentionally not in this plan.

**Type consistency:** `storage.create_fact(db, *, category, content, source, confidence, pinned)`, `list_facts(db, include_archived)`, `update_fact(db, id, **fields)`, `archive_fact(db, id)`, `get_context(db, cap)` used consistently across Tasks 2–7. Router models `FactIn`/`FactPatch` and `extract_in_background(user_msg, assistant_msg)` referenced consistently in Tasks 4 and 6. Frontend `UserFact`/`profile.*` consistent across Tasks 8–9.
