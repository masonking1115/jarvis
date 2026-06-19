import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base
from backend.modules.agent import service as svc
from backend.modules.tasks.models import Task


@pytest.fixture
def db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    yield sessionmaker(bind=eng)()


def test_add_todo_creates_task(db):
    out = svc.run(db, "add_todo", {"title": "Call the dentist", "due": "2026-06-19", "priority": 2})
    assert "Call the dentist" in out["text"]
    rows = db.query(Task).all()
    assert len(rows) == 1
    assert rows[0].title == "Call the dentist"
    assert rows[0].priority == 2
    assert rows[0].due_at is not None


def test_add_todo_requires_title(db):
    out = svc.run(db, "add_todo", {"title": "  "})
    assert "What should I add" in out["text"]
    assert db.query(Task).count() == 0


def test_list_todos_lists_open_week_tasks(db):
    svc.run(db, "add_todo", {"title": "Buy groceries"})
    svc.run(db, "add_todo", {"title": "Finish report", "priority": 1})
    text = svc.run(db, "list_todos", {})["text"]
    assert "Buy groceries" in text and "Finish report" in text


def test_list_todos_empty(db):
    assert "clear for this week" in svc.run(db, "list_todos", {})["text"]
