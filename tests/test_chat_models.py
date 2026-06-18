import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base
from backend.modules.chat.models import ChatTurn, ChatState, get_state


@pytest.fixture
def db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    yield sessionmaker(bind=eng)()


def test_get_state_is_singleton_with_defaults(db):
    s = get_state(db)
    assert s.id == 1 and s.tier == "fast" and s.mode == "" and s.compaction_summary == ""
    s2 = get_state(db)
    assert s2.id == 1  # same row, not a second one


def test_chat_turns_persist_and_order(db):
    db.add(ChatTurn(role="user", content="hi"))
    db.add(ChatTurn(role="assistant", content="hello", tier="fast"))
    db.commit()
    rows = db.query(ChatTurn).order_by(ChatTurn.id.asc()).all()
    assert [(r.role, r.content) for r in rows] == [("user", "hi"), ("assistant", "hello")]
    assert rows[1].tier == "fast"
