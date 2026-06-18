# tests/test_tier_dispatch.py
import json
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.db import Base
import backend.modules.agent.service as svc


@pytest.fixture
def db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    yield sessionmaker(bind=eng)()


class _FakeProvider:
    def __init__(self, payload): self.payload = payload; self.seen = {}
    def chat(self, system, messages, model=None):
        self.seen["model"] = model; self.seen["system"] = system
        return self.payload


def test_plan_returns_escalate(db, monkeypatch):
    fake = _FakeProvider(json.dumps({"kind": "escalate", "reason": "multi-step"}))
    monkeypatch.setattr(svc, "get_provider", lambda *a, **k: fake)
    monkeypatch.setattr(svc, "load_persona", lambda: "P")
    out = svc.plan(db, [{"role": "user", "content": "analyze my whole finances"}])
    assert out["kind"] == "escalate"


def test_forced_agent_tier_returns_escalate_without_routing(db, monkeypatch):
    # Should NOT call the planner at all when tier='agent'.
    def _boom(*a, **k): raise AssertionError("planner should be skipped")
    monkeypatch.setattr(svc, "get_provider", _boom)
    out = svc.plan(db, [{"role": "user", "content": "x"}], tier="agent")
    assert out["kind"] == "escalate"


def test_smart_tier_uses_smart_model(db, monkeypatch):
    fake = _FakeProvider("a thoughtful answer")
    monkeypatch.setattr(svc, "get_provider", lambda *a, **k: fake)
    monkeypatch.setattr(svc, "load_persona", lambda: "P")
    out = svc.plan(db, [{"role": "user", "content": "think about x"}], tier="smart")
    assert out == {"kind": "reply", "text": "a thoughtful answer"}
    assert fake.seen["model"] == svc.settings.smart_model
