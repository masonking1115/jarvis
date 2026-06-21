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
