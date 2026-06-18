# tests/test_deep_job.py
import importlib
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

# Use importlib to get the actual module (the package __init__ shadows the name otherwise).
ar = importlib.import_module("backend.modules.agent.router")
import backend.modules.agent.service as svc

# Mini-app with just the agent router to avoid full-app lifespan complexity.
_app = FastAPI()
_app.include_router(ar.router, prefix="/api/agent")
client = TestClient(_app)


def test_deep_job_lifecycle(monkeypatch):
    monkeypatch.setattr(ar, "_agent_text", lambda prompt, context: "deep answer")
    r = client.post("/api/agent/deep", json={"messages": [{"role": "user", "content": "go deep"}]})
    assert r.status_code == 200
    job_id = r.json()["job_id"]

    for _ in range(50):
        g = client.get(f"/api/agent/deep/{job_id}").json()
        if g["status"] == "done":
            break
        time.sleep(0.02)
    assert g["status"] == "done"
    assert g["text"] == "deep answer"


def test_deep_job_unknown_id():
    assert client.get("/api/agent/deep/nope").json()["status"] == "error"


def test_plan_accepts_tier(monkeypatch):
    monkeypatch.setattr(svc, "plan", lambda db, msgs, skill=None, tier=None: {"kind": "escalate", "reason": tier})
    r = client.post("/api/agent/plan", json={"messages": [{"role": "user", "content": "x"}], "tier": "agent"})
    assert r.json() == {"kind": "escalate", "reason": "agent"}
