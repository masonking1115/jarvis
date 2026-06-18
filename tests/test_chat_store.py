import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base
from backend.modules.chat import store
from backend.modules.chat.models import ChatTurn, get_state


@pytest.fixture
def db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    yield sessionmaker(bind=eng)()


def test_add_and_thread_messages(db):
    store.add_turn(db, "user", "hello")
    store.add_turn(db, "assistant", "hi sir", tier="fast")
    msgs = store.thread_messages(db)
    assert msgs == [{"role": "user", "content": "hello"},
                    {"role": "assistant", "content": "hi sir"}]


def test_compact_replaces_turns_with_summary(db):
    store.add_turn(db, "user", "a")
    store.add_turn(db, "assistant", "b")
    store.compact(db, "we discussed a and b")
    assert db.query(ChatTurn).count() == 0
    assert get_state(db).compaction_summary == "we discussed a and b"
    msgs = store.thread_messages(db)
    assert msgs[0]["role"] == "assistant" and "we discussed a and b" in msgs[0]["content"]
