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
