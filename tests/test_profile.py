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
