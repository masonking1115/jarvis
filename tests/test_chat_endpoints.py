import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base, get_db
import backend.modules.chat.router as cr


@pytest.fixture
def client():
    from sqlalchemy.pool import StaticPool
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)  # one shared in-memory connection across threads
    Base.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng)

    def _override():
        db = TestingSession()
        try: yield db
        finally: db.close()

    app = FastAPI()
    app.include_router(cr.router, prefix="/api/chat")
    app.dependency_overrides[get_db] = _override
    return TestClient(app)


def test_thread_empty_then_model_then_mode(client):
    r = client.get("/api/chat/thread").json()
    assert r == {"messages": [], "tier": "fast", "mode": ""}

    assert client.post("/api/chat/model", json={"tier": "agent"}).json()["tier"] == "agent"
    assert client.post("/api/chat/mode", json={"mode": "brainstorm"}).json()["mode"] == "brainstorm"

    r = client.get("/api/chat/thread").json()
    assert r["tier"] == "agent" and r["mode"] == "brainstorm"


def test_model_rejects_unknown_tier(client):
    assert client.post("/api/chat/model", json={"tier": "wizard"}).status_code == 422


def test_compact_summarizes_and_clears(client, monkeypatch):
    # seed a couple of turns through the store, via a direct session is simplest:
    from backend.modules.chat import store
    # reach the overridden session by calling the app's dependency once:
    gen = client.app.dependency_overrides[get_db]()
    db = next(gen)
    store.add_turn(db, "user", "hello")
    store.add_turn(db, "assistant", "hi")

    monkeypatch.setattr(cr, "_summarize", lambda msgs: "a short summary")
    out = client.post("/api/chat/compact", json={}).json()
    assert out["summary"] == "a short summary"
    assert client.get("/api/chat/thread").json()["messages"][0]["content"].startswith(
        "(summary of earlier conversation)")
