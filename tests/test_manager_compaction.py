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


def test_compact_threshold_default():
    from backend.core.config import settings
    assert settings.compact_token_threshold == 50_000


def test_estimate_tokens():
    from backend.modules.chat import store
    db = _db()
    assert store.estimate_tokens(db, 7) == 0           # empty thread
    store.add_turn(db, "user", "x" * 40, project_id=7)
    store.add_turn(db, "assistant", "y" * 40, project_id=7)
    assert store.estimate_tokens(db, 7) == 20           # 80 chars // 4


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
