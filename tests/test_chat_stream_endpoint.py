import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base, get_db
import backend.modules.chat.router as cr
import backend.modules.projects.models  # ensure Project registers with Base.metadata before create_all


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


def test_stream_agent_persists_session_and_hides_it(ctx, monkeypatch):
    client, TestingSession = ctx
    monkeypatch.setattr(cr.service, "plan",
                        lambda db, msgs, skill=None, tier=None, extra_context=None: {"kind": "escalate", "reason": "x"})
    seen = {}
    def fake_stream(prompt, context="", session_id=None, cwd=None):
        seen["session_id"] = session_id
        yield {"type": "session", "session_id": "sid-77"}
        yield {"type": "text", "text": "working"}
        yield {"type": "done", "text": "working"}
    monkeypatch.setattr(cr, "_agent_stream", fake_stream)

    r = client.post("/api/chat/stream", json={"text": "fix the bug", "tier": "agent"})
    evs = _events(r.text)
    assert not any(e["type"] == "session" for e in evs)     # session not leaked to client
    assert evs[-1]["type"] == "done"
    # persisted for next turn
    from backend.modules.chat.models import get_state
    assert get_state(TestingSession()).agent_session_id == "sid-77"


def test_stream_unconfigured_project_gives_setup_guidance(ctx, monkeypatch):
    client, TS = ctx
    from backend.modules.projects.models import Project
    db = TS(); p = Project(name="NoRepo"); db.add(p); db.commit(); pid = p.id
    monkeypatch.setattr(cr.service, "plan",
        lambda db, msgs, skill=None, tier=None, extra_context=None: {"kind": "escalate", "reason": "x"})
    def _boom(*a, **k):
        raise AssertionError("agent must NOT run for a project with no repo_path")
    monkeypatch.setattr(cr, "_agent_stream", _boom)
    r = client.post(f"/api/chat/stream?project_id={pid}", json={"text": "hi", "tier": "agent"})
    assert "nothing attached" in r.text   # setup guidance, agent never invoked


def test_stream_notion_only_project_runs_agent(ctx, monkeypatch):
    # A project with a Notion page but no repo should still run the agent (so the
    # user can chat about / log to the page) — NOT get blocked with setup guidance.
    client, TS = ctx
    from backend.modules.projects.models import Project
    db = TS(); p = Project(name="SSS", notion_url="https://notion.so/p/abc"); db.add(p); db.commit(); pid = p.id
    monkeypatch.setattr(cr.service, "plan",
        lambda db, msgs, skill=None, tier=None, extra_context=None: {"kind": "escalate", "reason": "x"})
    seen = {}
    def fake_stream(prompt, context="", session_id=None, cwd=None):
        seen["cwd"] = cwd; seen["ctx"] = context
        yield {"type": "text", "text": "here's what the page says"}
        yield {"type": "done", "text": ""}
    monkeypatch.setattr(cr, "_agent_stream", fake_stream)

    r = client.post(f"/api/chat/stream?project_id={pid}", json={"text": "what can you tell me about this project", "tier": "agent"})
    assert "nothing attached" not in r.text            # NOT blocked
    assert "here's what the page says" in r.text        # agent ran
    assert seen["cwd"] is None                          # no repo -> default cwd
    assert "Notion documentation log" in seen["ctx"]    # notion instructions injected


def test_stream_scopes_project_and_captures_notion_url(ctx, monkeypatch):
    client, TS = ctx
    # seed a buildable project (id 1) with a repo_path
    from backend.modules.projects.models import Project
    db = TS(); proj = Project(name="Demo", repo_path="."); db.add(proj); db.commit(); pid = proj.id
    monkeypatch.setattr(cr.service, "plan",
        lambda db, msgs, skill=None, tier=None, extra_context=None: {"kind": "escalate", "reason": "x"})
    seen = {}
    def fake_stream(prompt, context="", session_id=None, cwd=None):
        seen["cwd"] = cwd; seen["ctx"] = context
        yield {"type": "text", "text": "did work\nNOTION_URL: https://notion.so/p/abc"}
        yield {"type": "done", "text": ""}
    monkeypatch.setattr(cr, "_agent_stream", fake_stream)

    r = client.post(f"/api/chat/stream?project_id={pid}", json={"text": "build it", "tier": "agent"})
    assert "did work" in r.text and "NOTION_URL" not in r.text.split("data:")[-1]  # stripped from final
    db2 = TS(); saved = db2.get(Project, pid)
    assert saved.notion_url == "https://notion.so/p/abc"          # captured
    assert seen["cwd"] == "."                                      # ran in the project repo
    assert "Notion documentation log" in seen["ctx"]              # instructions injected


def test_stream_bumps_last_active_and_autocompacts(ctx, monkeypatch):
    client, TS = ctx
    from backend.modules.projects.models import Project
    from backend.modules.chat import store
    db = TS(); proj = Project(name="Demo", repo_path="."); db.add(proj); db.commit(); pid = proj.id
    # Pre-fill a huge thread so the post-turn estimate is over threshold.
    store.add_turn(db, "assistant", "z" * 250_000, project_id=pid)
    monkeypatch.setattr(cr.service, "plan",
        lambda db, msgs, skill=None, tier=None, extra_context=None: {"kind": "reply", "text": "ok"})
    monkeypatch.setattr(cr, "_summarize", lambda msgs: "ROLLUP")

    r = client.post(f"/api/chat/stream?project_id={pid}", json={"text": "hi"})
    assert r.status_code == 200
    saved = TS().get(Project, pid)
    assert saved.last_active_at is not None        # bumped
    assert saved.status_summary == "ROLLUP"        # auto-compacted -> status written
