# JARVIS Skill System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an extensible skill registry where instruction skills (markdown files) and action skills (existing coded tools) are unified, auto-selected by the planner with manual override, scoped so each skill only carries its own actions, and managed from files + a Skills page.

**Architecture:** A new auto-mounting `skills` module loads instruction skills from `backend/skills/*.md`, unifies them with `agent/registry.py` action skills, and persists enable/disable in a `SkillSetting` table. The planner does a cheap stage-1 route (names + when-to-use); a chosen instruction skill triggers a server-side stage-2 answer with only that skill's body and declared actions. A Skills page toggles skills.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (`Mapped[]`), SQLite, Next.js 14 App Router, Tailwind, pytest.

**Reference (read before starting):**
- Spec: `docs/superpowers/specs/2026-06-17-jarvis-skill-system-design.md`
- Module pattern + placeholder trick: `backend/modules/profile/` (built the same way)
- Planner to extend: `backend/modules/agent/service.py` (`plan`, `_PLAN_INSTRUCTION`, `_parse`) and `backend/modules/agent/registry.py` (`TOOLS`, `NAMES`, `render`)
- Plan endpoint: `backend/modules/agent/router.py`
- Context reuse: `backend/modules/chat/router.py` (`load_persona`, `_build_context`)
- Model registration: `backend/core/db.py::init_db`
- Test style + in-memory fixture: `tests/test_profile.py`; FakeDB: `tests/test_agent.py`
- Frontend: `web/lib/api.ts`, `web/components/Sidebar.tsx`, page pattern `web/app/(console)/profile/page.tsx`

---

### Task 1: Instruction skill loader + seed skills

**Files:**
- Create: `backend/modules/skills/__init__.py` (placeholder)
- Create: `backend/modules/skills/loader.py`
- Create: `backend/skills/tax-helper.md`, `backend/skills/fitness-coach.md`
- Test: `tests/test_skills.py`

- [ ] **Step 1: Create the package placeholder** (real router added in Task 5)

`backend/modules/skills/__init__.py`:
```python
# placeholder until router.py exists (replaced in Task 5)
router = None
```

- [ ] **Step 2: Create the two seed skill files**

`backend/skills/tax-helper.md`:
```markdown
---
name: tax-helper
when_to_use: When the user asks about taxes, deductions, filing, 1099s, W-2s, or their tax documents.
actions: []
enabled: true
---
You are acting as a meticulous tax-preparation assistant for the user. Ground
every answer in the user's actual tax documents and finances when available.
Explain in plain language. Never give legal or filing guarantees; when a
situation is complex or high-stakes, recommend a CPA. Be precise with numbers
and never invent figures you don't have.
```

`backend/skills/fitness-coach.md`:
```markdown
---
name: fitness-coach
when_to_use: When the user asks about workouts, training, exercise routines, or fitness goals.
actions: []
enabled: true
---
You are the user's direct, encouraging fitness coach. Ground advice in the
user's goals and recent activity from the context provided. Give specific,
measurable next steps (sets, reps, distances, dates) rather than vague
encouragement. Keep them accountable and flag when rest or recovery is smarter.
```

- [ ] **Step 3: Write failing tests**

`tests/test_skills.py`:
```python
from backend.modules.skills import loader
from backend.modules.skills.loader import parse_skill


def test_parse_full_frontmatter():
    text = (
        "---\n"
        "name: trip-planner\n"
        "when_to_use: When planning travel.\n"
        "actions: [web_search, weather]\n"
        "enabled: true\n"
        "---\n"
        "You are a travel planner."
    )
    s = parse_skill(text)
    assert s is not None
    assert s.name == "trip-planner"
    assert s.when_to_use == "When planning travel."
    assert s.actions == ["web_search", "weather"]
    assert s.enabled is True
    assert s.body == "You are a travel planner."


def test_parse_empty_actions_and_default_enabled():
    text = "---\nname: x\nwhen_to_use: y\nactions: []\n---\nbody"
    s = parse_skill(text)
    assert s.actions == []
    assert s.enabled is True   # default when omitted


def test_parse_enabled_false():
    text = "---\nname: x\nwhen_to_use: y\nenabled: false\n---\nbody"
    assert parse_skill(text).enabled is False


def test_parse_missing_required_returns_none():
    assert parse_skill("---\nwhen_to_use: y\n---\nbody") is None   # no name
    assert parse_skill("no frontmatter at all") is None


def test_load_skills_reads_dir(tmp_path):
    (tmp_path / "a.md").write_text("---\nname: a\nwhen_to_use: ua\n---\nbody a", encoding="utf-8")
    (tmp_path / "bad.md").write_text("garbage", encoding="utf-8")   # skipped, no crash
    out = loader.load_skills(tmp_path)
    assert [s.name for s in out] == ["a"]


def test_load_skills_includes_seeds():
    names = [s.name for s in loader.load_skills()]   # default dir = backend/skills
    assert "tax-helper" in names and "fitness-coach" in names
```

- [ ] **Step 4: Run — verify failure**

Run: `python -m pytest tests/test_skills.py -v`
Expected: FAIL (`loader` module missing)

- [ ] **Step 5: Implement the loader**

`backend/modules/skills/loader.py`:
```python
"""Discover and parse instruction skills from backend/skills/*.md."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

# backend/skills (loader.py is backend/modules/skills/loader.py)
SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / "skills"


@dataclass
class InstructionSkill:
    name: str
    when_to_use: str
    body: str
    actions: list[str] = field(default_factory=list)
    enabled: bool = True


def _split_frontmatter(text: str) -> tuple[dict, str]:
    t = text.lstrip()
    if not t.startswith("---"):
        return {}, text
    rest = t[3:]
    end = rest.find("\n---")
    if end == -1:
        return {}, text
    fm, body = rest[:end], rest[end + 4:].lstrip("\n")
    meta: dict = {}
    for line in fm.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        k, _, v = line.partition(":")
        meta[k.strip().lower()] = v.strip()
    return meta, body


def _parse_list(v: str) -> list[str]:
    v = v.strip()
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    return [x.strip() for x in v.split(",") if x.strip()]


def parse_skill(text: str) -> InstructionSkill | None:
    meta, body = _split_frontmatter(text)
    name = meta.get("name", "").strip()
    when = meta.get("when_to_use", "").strip()
    if not name or not when:
        return None
    enabled = meta.get("enabled", "true").strip().lower() not in ("false", "0", "no")
    return InstructionSkill(name=name, when_to_use=when, body=body.strip(),
                            actions=_parse_list(meta.get("actions", "")), enabled=enabled)


def load_skills(skills_dir: Path | None = None) -> list[InstructionSkill]:
    d = Path(skills_dir) if skills_dir else SKILLS_DIR
    out: list[InstructionSkill] = []
    if not d.exists():
        return out
    for p in sorted(d.glob("*.md")):
        try:
            s = parse_skill(p.read_text(encoding="utf-8"))
            if s:
                out.append(s)
        except Exception:  # noqa: BLE001 — a bad file must never break discovery
            continue
    return out
```

- [ ] **Step 6: Run — verify pass**

Run: `python -m pytest tests/test_skills.py -v`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add backend/modules/skills/__init__.py backend/modules/skills/loader.py backend/skills/tax-helper.md backend/skills/fitness-coach.md tests/test_skills.py
git commit -m "feat(skills): instruction-skill loader + seed skills"
```

---

### Task 2: SkillSetting model + DB registration

**Files:**
- Create: `backend/modules/skills/models.py`
- Modify: `backend/core/db.py`
- Test: `tests/test_skills.py` (extend)

- [ ] **Step 1: Write the model**

`backend/modules/skills/models.py`:
```python
from sqlalchemy import String, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class SkillSetting(Base):
    """Enable/disable overlay for a skill (instruction or action). Absence of a
    row means the skill uses its file/code default (enabled)."""
    __tablename__ = "skill_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
```

- [ ] **Step 2: Register in `init_db`**

In `backend/core/db.py`, inside `init_db()`, after the profile import line, add:
```python
    from backend.modules.profile import models as _profile_models  # noqa: F401
    from backend.modules.skills import models as _skills_models  # noqa: F401
```

- [ ] **Step 3: Write failing test (fixture + model)**

Append to `tests/test_skills.py`:
```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base
from backend.modules.skills.models import SkillSetting


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[SkillSetting.__table__])
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    s = Session()
    try:
        yield s
    finally:
        s.close()


def test_skillsetting_defaults(db):
    row = SkillSetting(name="tax-helper")
    db.add(row); db.commit(); db.refresh(row)
    assert row.id is not None and row.enabled is True
```

- [ ] **Step 4: Run — verify pass**

Run: `python -m pytest tests/test_skills.py -v -k skillsetting`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/modules/skills/models.py backend/core/db.py tests/test_skills.py
git commit -m "feat(skills): SkillSetting model + db registration"
```

---

### Task 3: Unified registry

**Files:**
- Create: `backend/modules/skills/registry.py`
- Test: `tests/test_skills.py` (extend)

- [ ] **Step 1: Write failing tests**

Append to `tests/test_skills.py`:
```python
from backend.modules.skills import registry


def test_all_skills_includes_both_kinds(db):
    skills = registry.all_skills(db)
    kinds = {s.name: s.kind for s in skills}
    assert kinds.get("tax-helper") == "instruction"
    assert kinds.get("weather") == "action"


def test_disable_overlay_hides_from_enabled(db):
    db.add(SkillSetting(name="tax-helper", enabled=False)); db.commit()
    enabled = {s.name for s in registry.enabled_instruction_skills(db)}
    assert "tax-helper" not in enabled
    assert "fitness-coach" in enabled


def test_general_actions_filtered_by_disable(db):
    names = [t["name"] for t in registry.general_action_tools(db)]
    assert "weather" in names
    db.add(SkillSetting(name="weather", enabled=False)); db.commit()
    names2 = [t["name"] for t in registry.general_action_tools(db)]
    assert "weather" not in names2


def test_skill_action_tools_scopes(db):
    tools = registry.skill_action_tools(db, ["web_search"])
    assert [t["name"] for t in tools] == ["web_search"]


def test_disabled_names_resilient_to_missing_table():
    # FakeDB has no real table; must not raise, returns empty set
    class FakeDB:
        def query(self, *a, **k): return self
        def filter(self, *a, **k): return self
        def all(self): raise RuntimeError("no such table")
    assert registry._disabled_names(FakeDB()) == set()
```

- [ ] **Step 2: Run — verify failure**

Run: `python -m pytest tests/test_skills.py -v -k "all_skills or overlay or general_actions or scopes or resilient"`
Expected: FAIL (`registry` missing)

- [ ] **Step 3: Implement the registry**

`backend/modules/skills/registry.py`:
```python
"""Unify instruction skills (files) + action skills (agent registry), with an
enable/disable overlay from SkillSetting."""
from __future__ import annotations

from dataclasses import dataclass, field
from sqlalchemy.orm import Session

from backend.modules.agent import registry as actions   # data only (no import cycle)
from . import loader
from .models import SkillSetting

# Actions available in the default ("general") context when no specialized
# instruction skill is active. This preserves today's behavior.
GENERAL_ACTIONS = ["web_search", "weather", "navigate", "open_flyover"]


@dataclass
class Skill:
    name: str
    kind: str                 # "instruction" | "action"
    when_to_use: str
    enabled: bool
    actions: list[str] = field(default_factory=list)   # instruction only
    body: str | None = None                             # instruction only


def _disabled_names(db: Session) -> set[str]:
    try:
        rows = db.query(SkillSetting).filter(SkillSetting.enabled == False).all()  # noqa: E712
        return {r.name for r in rows}
    except Exception:  # noqa: BLE001 — overlay is best-effort; absence => all enabled
        return set()


def _action_defs() -> dict[str, dict]:
    return {t["name"]: t for t in actions.TOOLS}


def all_skills(db: Session) -> list[Skill]:
    disabled = _disabled_names(db)
    out: list[Skill] = []
    for s in loader.load_skills():
        out.append(Skill(name=s.name, kind="instruction", when_to_use=s.when_to_use,
                         enabled=(s.enabled and s.name not in disabled),
                         actions=s.actions, body=s.body))
    for t in actions.TOOLS:
        out.append(Skill(name=t["name"], kind="action", when_to_use=t["desc"],
                         enabled=(t["name"] not in disabled)))
    return out


def enabled_instruction_skills(db: Session) -> list[Skill]:
    return [s for s in all_skills(db) if s.kind == "instruction" and s.enabled]


def get_instruction(db: Session, name: str) -> Skill | None:
    for s in all_skills(db):
        if s.kind == "instruction" and s.name == name:
            return s
    return None


def general_action_tools(db: Session) -> list[dict]:
    disabled = _disabled_names(db)
    defs = _action_defs()
    return [defs[n] for n in GENERAL_ACTIONS if n in defs and n not in disabled]


def skill_action_tools(db: Session, names: list[str]) -> list[dict]:
    disabled = _disabled_names(db)
    defs = _action_defs()
    return [defs[n] for n in names if n in defs and n not in disabled]


def render_actions(tools: list[dict]) -> str:
    if not tools:
        return "Available actions: (none)"
    lines = ["Available actions:"]
    for t in tools:
        lines.append(f'- {t["name"]}({t["args"]}) — {t["desc"]}')
    return "\n".join(lines)
```

- [ ] **Step 4: Run — verify pass**

Run: `python -m pytest tests/test_skills.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/modules/skills/registry.py tests/test_skills.py
git commit -m "feat(skills): unified registry (instruction + action) with enable/disable overlay"
```

---

### Task 4: Skill service (router context + stage-2 answer)

**Files:**
- Create: `backend/modules/skills/service.py`
- Test: `tests/test_skills.py` (extend)

- [ ] **Step 1: Write failing tests**

Append to `tests/test_skills.py`:
```python
from backend.modules.skills import service as skills_service


class FakeDB2:   # no real tables; registry._disabled_names handles the raise
    def query(self, *a, **k): return self
    def filter(self, *a, **k): return self
    def all(self): return []
    def order_by(self, *a, **k): return self
    def limit(self, *a, **k): return self


def test_router_context_lists_actions_and_skills():
    ctx = skills_service.router_context(FakeDB2())
    assert "web_search" in ctx
    assert "tax-helper" in ctx and "fitness-coach" in ctx


def test_answer_unknown_skill_replies():
    out = skills_service.answer(FakeDB2(), "nope", [{"role": "user", "content": "hi"}])
    assert out["kind"] == "reply"


def test_answer_drops_action_outside_skill_scope(monkeypatch):
    # tax-helper declares actions: [] -> any action must be rejected -> reply
    monkeypatch.setattr(skills_service, "get_provider",
                        lambda o=None: type("P", (), {"name": "p",
                        "chat": lambda self, system, messages, model=None:
                        '{"kind":"action","tool":"weather","args":{},"ack":"no"}'})())
    monkeypatch.setattr(skills_service, "load_persona", lambda: "persona")
    monkeypatch.setattr(skills_service, "_build_context", lambda db: "ctx")
    out = skills_service.answer(FakeDB2(), "tax-helper", [{"role": "user", "content": "x"}])
    assert out["kind"] == "reply"


def test_answer_allows_declared_action(monkeypatch):
    from backend.modules.skills import loader as ldr
    from backend.modules.skills.loader import InstructionSkill
    monkeypatch.setattr(ldr, "load_skills", lambda d=None: [
        InstructionSkill(name="trip", when_to_use="travel", body="plan trips",
                         actions=["web_search"], enabled=True)])
    monkeypatch.setattr(skills_service, "get_provider",
                        lambda o=None: type("P", (), {"name": "p",
                        "chat": lambda self, system, messages, model=None:
                        '{"kind":"action","tool":"web_search","args":{"query":"q"},"ack":"ok"}'})())
    monkeypatch.setattr(skills_service, "load_persona", lambda: "persona")
    monkeypatch.setattr(skills_service, "_build_context", lambda db: "ctx")
    out = skills_service.answer(FakeDB2(), "trip", [{"role": "user", "content": "x"}])
    assert out["kind"] == "action" and out["tool"] == "web_search"
```

- [ ] **Step 2: Run — verify failure**

Run: `python -m pytest tests/test_skills.py -v -k "router_context or answer"`
Expected: FAIL (`service` missing)

- [ ] **Step 3: Implement the service**

`backend/modules/skills/service.py`:
```python
"""Skill selection support for the planner: render the router context (stage 1)
and produce a scoped answer for a chosen instruction skill (stage 2)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.llm import get_provider
from backend.modules.chat.router import load_persona, _build_context
from backend.modules.agent.service import _parse   # agent.service does not import skills (no cycle)
from . import registry

_SKILL_ANSWER_INSTRUCTION = (
    "Respond with ONLY a JSON object — no prose, no code fences:\n"
    '- Answer: {"kind":"reply","text":"<concise spoken answer>"}\n'
    '- Action: {"kind":"action","tool":"<one of the actions above>","args":{...},'
    '"ack":"<short spoken acknowledgement>"}\n'
    "Use an action only if one clearly applies; otherwise reply."
)


def router_context(db: Session) -> str:
    """Stage-1 prompt fragment: general actions + enabled instruction skills."""
    parts = [registry.render_actions(registry.general_action_tools(db))]
    skills = registry.enabled_instruction_skills(db)
    if skills:
        lines = ['Available skills (return {"kind":"skill","name":"<name>"} to use one):']
        for s in skills:
            lines.append(f"- {s.name} — {s.when_to_use}")
        parts.append("\n".join(lines))
    return "\n\n".join(parts)


def answer(db: Session, name: str, messages: list[dict]) -> dict:
    """Stage 2: answer under one instruction skill, scoped to its actions."""
    skill = registry.get_instruction(db, name)
    if not skill:
        return {"kind": "reply", "text": "I can't find that skill, sir."}
    tools = registry.skill_action_tools(db, skill.actions)
    system = (
        load_persona() + "\n\n" + _build_context(db)
        + f"\n\n# Active skill: {skill.name}\n" + (skill.body or "")
        + "\n\n" + registry.render_actions(tools)
        + "\n\n" + _SKILL_ANSWER_INSTRUCTION
    )
    raw = get_provider().chat(system=system, messages=messages, model=settings.voice_model)
    out = _parse(raw)
    if out.get("kind") == "action" and out.get("tool") not in set(skill.actions):
        # model tried to use a tool this skill doesn't carry — fall back to a reply
        return {"kind": "reply", "text": out.get("ack") or out.get("text") or "Done, sir."}
    return out
```

- [ ] **Step 4: Run — verify pass**

Run: `python -m pytest tests/test_skills.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/modules/skills/service.py tests/test_skills.py
git commit -m "feat(skills): router context + scoped stage-2 answer service"
```

---

### Task 5: Skills API endpoints

**Files:**
- Create: `backend/modules/skills/router.py`
- Modify: `backend/modules/skills/__init__.py` (replace placeholder)
- Test: `tests/test_skills.py` (extend)

- [ ] **Step 1: Write failing tests** (call route functions directly with the fixture session)

Append to `tests/test_skills.py`:
```python
import importlib
skills_router = importlib.import_module("backend.modules.skills.router")


def test_endpoint_list(db):
    out = skills_router.list_skills(db=db)
    names = {s["name"] for s in out["skills"]}
    assert "tax-helper" in names and "weather" in names
    tax = next(s for s in out["skills"] if s["name"] == "tax-helper")
    assert tax["kind"] == "instruction" and tax["actions"] == [] and tax["enabled"] is True


def test_endpoint_toggle(db):
    res = skills_router.toggle("tax-helper", skills_router.TogglePatch(enabled=False), db=db)
    assert res["enabled"] is False
    tax = next(s for s in skills_router.list_skills(db=db)["skills"] if s["name"] == "tax-helper")
    assert tax["enabled"] is False


def test_endpoint_toggle_unknown_404(db):
    import pytest as _pytest
    from fastapi import HTTPException
    with _pytest.raises(HTTPException):
        skills_router.toggle("does-not-exist", skills_router.TogglePatch(enabled=True), db=db)
```

- [ ] **Step 2: Run — verify failure**

Run: `python -m pytest tests/test_skills.py -v -k endpoint`
Expected: FAIL (`router` has no `list_skills`)

- [ ] **Step 3: Implement the router**

`backend/modules/skills/router.py`:
```python
"""Skills endpoints (/api/skills): list all skills + enable/disable toggle."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from . import registry
from .models import SkillSetting

router = APIRouter()


class TogglePatch(BaseModel):
    enabled: bool


def _ser(s: registry.Skill) -> dict:
    return {"name": s.name, "kind": s.kind, "when_to_use": s.when_to_use,
            "actions": s.actions, "enabled": s.enabled}


@router.get("")
def list_skills(db: Session = Depends(get_db)):
    skills = registry.all_skills(db)
    return {"skills": [_ser(s) for s in skills], "count": len(skills)}


@router.patch("/{name}")
def toggle(name: str, body: TogglePatch, db: Session = Depends(get_db)):
    known = {s.name for s in registry.all_skills(db)}
    if name not in known:
        raise HTTPException(status_code=404, detail="skill not found")
    row = db.query(SkillSetting).filter(SkillSetting.name == name).first()
    if row is None:
        db.add(SkillSetting(name=name, enabled=body.enabled))
    else:
        row.enabled = body.enabled
    db.commit()
    return {"name": name, "enabled": body.enabled}
```

- [ ] **Step 4: Replace the placeholder `__init__.py`**

`backend/modules/skills/__init__.py`:
```python
from .router import router

__all__ = ["router"]
```

- [ ] **Step 5: Run — verify pass + module imports**

Run: `python -m pytest tests/test_skills.py -v`
Expected: all PASS

Run: `python -c "from backend.modules.skills import router; print(type(router).__name__)"`
Expected: `APIRouter`

- [ ] **Step 6: Commit**

```bash
git add backend/modules/skills/router.py backend/modules/skills/__init__.py tests/test_skills.py
git commit -m "feat(skills): /api/skills list + toggle endpoints"
```

---

### Task 6: Wire the planner (selection + manual override)

**Files:**
- Modify: `backend/modules/agent/service.py` (`_PLAN_INSTRUCTION`, `plan`)
- Modify: `backend/modules/agent/router.py` (`PlanIn`, `plan` endpoint)
- Test: `tests/test_skills.py` (extend)

- [ ] **Step 1: Write failing tests**

Append to `tests/test_skills.py`:
```python
def test_plan_routes_to_skill(monkeypatch):
    from backend.modules.agent import service as agent_service

    calls = {"n": 0}
    class P:
        name = "p"
        def chat(self, system, messages, model=None):
            calls["n"] += 1
            if calls["n"] == 1:
                return '{"kind":"skill","name":"tax-helper"}'      # stage 1 routes
            return '{"kind":"reply","text":"Per your documents, sir."}'  # stage 2 answers
    monkeypatch.setattr(agent_service, "get_provider", lambda o=None: P())
    from backend.modules.skills import service as ss
    monkeypatch.setattr(ss, "get_provider", lambda o=None: P())
    monkeypatch.setattr(ss, "load_persona", lambda: "persona")
    monkeypatch.setattr(ss, "_build_context", lambda db: "ctx")

    out = agent_service.plan(FakeDB2(), [{"role": "user", "content": "help with my taxes"}])
    assert out["kind"] == "reply" and "documents" in out["text"]
    assert calls["n"] == 2     # two-stage


def test_plan_forced_skill_skips_routing(monkeypatch):
    from backend.modules.agent import service as agent_service
    from backend.modules.skills import service as ss
    class P:
        name = "p"
        def chat(self, system, messages, model=None):
            return '{"kind":"reply","text":"forced tax answer"}'
    monkeypatch.setattr(ss, "get_provider", lambda o=None: P())
    monkeypatch.setattr(ss, "load_persona", lambda: "persona")
    monkeypatch.setattr(ss, "_build_context", lambda db: "ctx")
    out = agent_service.plan(FakeDB2(), [{"role": "user", "content": "anything"}], skill="tax-helper")
    assert out["kind"] == "reply" and out["text"] == "forced tax answer"
```

- [ ] **Step 2: Run — verify failure**

Run: `python -m pytest tests/test_skills.py -v -k "routes_to_skill or forced_skill"`
Expected: FAIL (`plan` takes no `skill`; no skill routing)

- [ ] **Step 3: Update `_PLAN_INSTRUCTION`**

In `backend/modules/agent/service.py`, replace the entire `_PLAN_INSTRUCTION` assignment with:
```python
_PLAN_INSTRUCTION = (
    "Decide what the user's latest message needs, using the actions and skills listed above.\n"
    "Respond with ONLY a JSON object — no prose, no code fences:\n"
    '- Plain answer: {"kind":"reply","text":"<concise spoken answer>"}\n'
    '- Action: {"kind":"action","tool":"<one of the action names>","args":{...},'
    '"ack":"<short spoken acknowledgement, e.g. \'Yes sir, performing the weather search now.\'>"}\n'
    '- Specialized skill: {"kind":"skill","name":"<one of the skill names>"}\n'
    "Prefer a skill when the request matches its description; use an action when it matches one; "
    "otherwise reply. If the user explicitly names a skill, use that skill.\n"
    "Be proactive: when the user's known facts and goals are relevant, connect them to the moment "
    "and suggest or take the next concrete step toward a goal (confirming anything irreversible first)."
)
```

- [ ] **Step 4: Rewrite `plan`**

In `backend/modules/agent/service.py`, replace the whole `plan` function with:
```python
def plan(db: Session, messages: list[dict], skill: str | None = None) -> dict:
    # Lazy import avoids an import cycle (skills.service imports agent.service._parse).
    from backend.modules.skills import service as skills_service
    if skill:
        return skills_service.answer(db, skill, messages)

    provider = get_provider()
    facts = profile_storage.get_context(db)
    system = load_persona()
    if facts:
        system += "\n\n" + facts
    system += "\n\n" + skills_service.router_context(db) + "\n\n" + _PLAN_INSTRUCTION
    raw = provider.chat(system=system, messages=messages, model=settings.voice_model)
    out = _parse(raw)

    if out.get("kind") == "skill":
        name = out.get("name")
        if any(s.name == name for s in skills_service.registry.enabled_instruction_skills(db)):
            return skills_service.answer(db, name, messages)
        return {"kind": "reply", "text": "I'm not sure how to help with that, sir."}
    if out.get("kind") == "action" and out.get("tool") not in registry.NAMES:
        return {"kind": "reply", "text": out.get("ack") or "I can't do that yet, sir."}
    return out
```

(`skills_service.registry` resolves because `skills/service.py` imports `registry`.)

- [ ] **Step 5: Add `skill` to the plan endpoint**

In `backend/modules/agent/router.py`, change `PlanIn`:
```python
class PlanIn(BaseModel):
    messages: list[Msg]
    skill: str | None = None
```

And in the `plan` route, change the planning call to forward `skill`:
```python
    result = service.plan(db, msgs, skill=body.skill)
```

- [ ] **Step 6: Run — verify pass (new + existing agent/profile tests)**

Run: `python -m pytest tests/test_skills.py tests/test_agent.py tests/test_profile.py -v`
Expected: all PASS (the existing `test_agent` plan tests still pass: their FakeDB returns `[]` for the overlay query, and `router_context` reads the real seed files harmlessly)

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest -q`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add backend/modules/agent/service.py backend/modules/agent/router.py tests/test_skills.py
git commit -m "feat(skills): planner skill selection (two-stage) + manual override"
```

---

### Task 7: Frontend API client

**Files:**
- Modify: `web/lib/api.ts`

- [ ] **Step 1: Add the type + client**

In `web/lib/api.ts`, after the Profile block (before the Flyover section), add:
```typescript
// ---- Skills (extensible capability registry) ----
export type Skill = {
  name: string;
  kind: string;            // instruction | action
  when_to_use: string;
  actions: string[];
  enabled: boolean;
};

export const skills = {
  list:   ()                              => api.get<{ skills: Skill[]; count: number }>("/api/skills"),
  toggle: (name: string, enabled: boolean) =>
            api.patch<{ name: string; enabled: boolean }>(`/api/skills/${name}`, { enabled }),
};
```

- [ ] **Step 2: Verify type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add web/lib/api.ts
git commit -m "feat(skills): frontend api client + Skill type"
```

---

### Task 8: Skills page + nav

**Files:**
- Create: `web/app/(console)/skills/page.tsx`
- Modify: `web/components/Sidebar.tsx`

- [ ] **Step 1: Add the nav entry**

In `web/components/Sidebar.tsx`, add to `NAV` after the `profile` entry:
```typescript
  { href: "/profile",   label: "Profile" },
  { href: "/skills",    label: "Skills" },
  { href: "/settings",  label: "Settings" },
```

- [ ] **Step 2: Create the Skills page**

`web/app/(console)/skills/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { skills as skillsApi, Skill } from "@/lib/api";

export default function SkillsPage() {
  const [items, setItems] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setItems((await skillsApi.list()).skills); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function toggle(s: Skill) {
    setItems(prev => prev.map(x => x.name === s.name ? { ...x, enabled: !x.enabled } : x));
    try { await skillsApi.toggle(s.name, !s.enabled); }
    catch { load(); }   // revert on failure
  }

  const groups: { kind: string; label: string }[] = [
    { kind: "instruction", label: "Instruction skills" },
    { kind: "action", label: "Action skills" },
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl tracking-wider text-jarvis-text mb-1">Skills</h1>
      <p className="text-jarvis-muted text-sm mb-5">
        What JARVIS can do. Instruction skills are markdown files in <code>backend/skills/</code>;
        action skills are built-in tools. Toggle any on or off.
      </p>

      {loading ? (
        <p className="text-jarvis-muted">Loading…</p>
      ) : (
        groups.map(g => {
          const list = items.filter(s => s.kind === g.kind);
          if (!list.length) return null;
          return (
            <div key={g.kind} className="mb-6">
              <h2 className="font-ui text-xs tracking-[0.22em] uppercase text-jarvis-accent mb-2">{g.label}</h2>
              <ul className="space-y-2">
                {list.map(s => (
                  <li key={s.name}
                    className="flex items-start gap-3 border border-jarvis-border rounded px-3 py-2 bg-[#040813]/50">
                    <div className="flex-1">
                      <div className="text-jarvis-text text-sm font-medium">{s.name}</div>
                      <div className="text-jarvis-muted text-xs mt-0.5">{s.when_to_use}</div>
                      {s.actions.length > 0 && (
                        <div className="text-[10px] text-jarvis-dim mt-1">tools: {s.actions.join(", ")}</div>
                      )}
                    </div>
                    <button onClick={() => toggle(s)}
                      className={`shrink-0 text-xs px-2 py-1 rounded border ${
                        s.enabled
                          ? "border-jarvis-accent text-jarvis-accent"
                          : "border-jarvis-border text-jarvis-muted"
                      }`}>
                      {s.enabled ? "On" : "Off"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify type-check + render**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors.

With both servers running, open `http://localhost:3000/skills`.
Expected: tax-helper, fitness-coach (instruction) and the 4 actions listed; toggling persists across reload.

- [ ] **Step 4: Commit**

```bash
git add web/app/(console)/skills/page.tsx web/components/Sidebar.tsx
git commit -m "feat(skills): Skills management page + sidebar nav"
```

---

### Task 9: End-to-end verification

**Files:** none (manual verification)

- [ ] **Step 1: Full backend suite**

Run: `python -m pytest -q`
Expected: all PASS (existing + new `tests/test_skills.py`).

- [ ] **Step 2: Restart the backend** (new module mounts at startup)

Stop the running backend and restart: `uvicorn backend.main:app --reload --port 8000`
Then: `curl -s http://localhost:8000/api/skills`
Expected: JSON listing tax-helper, fitness-coach, and the 4 actions.

- [ ] **Step 3: Live skill routing check**

`curl -s -X POST http://localhost:8000/api/agent/plan -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"I have a question about my W-2 deductions"}]}'`
Expected: a `{"kind":"reply",...}` answer in the tax-helper voice (grounded, cautious, suggests a CPA when complex).

- [ ] **Step 4: Live scoping check**

`curl -s -X POST http://localhost:8000/api/agent/plan -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"what is the weather"}]}'`
Expected: routes to the general context and returns a `weather` action (proving general actions still work and aren't trapped behind a skill).

---

## Self-Review Notes

**Spec coverage:** unified registry instruction+action (Task 3) ✓; markdown files + loader (Task 1) ✓; SkillSetting enable/disable (Tasks 2,3,5) ✓; two-stage selection (Task 6) ✓; skill-scoped actions + general default set (Tasks 3,4,6) ✓; manual override via `skill` param (Task 6) ✓; Skills page + API (Tasks 5,7,8) ✓; seed skills (Task 1) ✓; resilience to malformed files + missing overlay table (Tasks 1,3) ✓; testing each backend task ✓.

**Out of scope (per spec):** in-app authoring of skill bodies, multi-step tool loops within a skill, Slack/Linear actions.

**Type consistency:** `loader.load_skills(dir)` / `parse_skill` / `InstructionSkill(name, when_to_use, body, actions, enabled)` consistent (Tasks 1,3,4). `registry.Skill(name, kind, when_to_use, enabled, actions, body)`, `all_skills`/`enabled_instruction_skills`/`get_instruction`/`general_action_tools`/`skill_action_tools`/`render_actions`/`_disabled_names`/`GENERAL_ACTIONS` consistent (Tasks 3–6). `skills_service.router_context(db)` and `answer(db, name, messages)` consistent (Tasks 4,6). `plan(db, messages, skill=None)` and `PlanIn.skill` consistent (Task 6). Frontend `Skill{name,kind,when_to_use,actions,enabled}` + `skills.list/toggle` consistent (Tasks 7,8). Endpoint `TogglePatch{enabled}` consistent (Tasks 5,8).

**Cross-test safety:** `_disabled_names` swallows a missing-table error → existing `tests/test_profile.py` (fixture creates only `UserFact`) and `tests/test_agent.py` (FakeDB) keep passing when `plan` now calls `router_context`. Verified by Task 6 Step 6 running all three test files.
