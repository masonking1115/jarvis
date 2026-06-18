import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base, get_db
import backend.modules.chat.router as cr


@pytest.fixture
def ctx():
    from sqlalchemy.pool import StaticPool
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)  # one shared in-memory connection across threads
    Base.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng)
    # /stream opens its OWN session via cr.SessionLocal — point it at the test engine.
    cr.SessionLocal = TestingSession

    def _override():
        db = TestingSession()
        try: yield db
        finally: db.close()

    app = FastAPI()
    app.include_router(cr.router, prefix="/api/chat")
    app.dependency_overrides[get_db] = _override
    return TestClient(app), TestingSession


def _events(resp_text):
    return [json.loads(line[5:]) for line in resp_text.splitlines()
            if line.startswith("data:")]


def test_stream_reply_persists_turn(ctx, monkeypatch):
    client, _ = ctx
    monkeypatch.setattr(cr.service, "plan",
                        lambda db, msgs, skill=None, tier=None, extra_context=None: {"kind": "reply", "text": "hello sir"})
    r = client.post("/api/chat/stream", json={"text": "hi"})
    evs = _events(r.text)
    assert {"type": "text", "text": "hello sir"} in evs
    assert evs[-1]["type"] == "done"
    # user + assistant persisted
    assert client.get("/api/chat/thread").json()["messages"] == [
        {"role": "user", "content": "hi", "tier": None},
        {"role": "assistant", "content": "hello sir", "tier": "fast"},
    ]


def test_stream_agent_tier_forwards_agent_events(ctx, monkeypatch):
    client, _ = ctx
    monkeypatch.setattr(cr.service, "plan",
                        lambda db, msgs, skill=None, tier=None, extra_context=None: {"kind": "escalate", "reason": "x"})
    def fake_stream(prompt, context="", **k):
        yield {"type": "text", "text": "working"}
        yield {"type": "todos", "todos": [{"content": "step", "status": "pending"}]}
        yield {"type": "done", "text": "working"}
    monkeypatch.setattr(cr, "_agent_stream", fake_stream)

    r = client.post("/api/chat/stream", json={"text": "go deep", "tier": "agent"})
    evs = _events(r.text)
    assert any(e["type"] == "todos" for e in evs)
    assert evs[-1]["type"] == "done"
