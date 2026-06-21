import os, tempfile
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from backend.core.db import Base, get_db
import backend.modules.projects.router as pr


@pytest.fixture
def client(monkeypatch):
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    TS = sessionmaker(bind=eng)
    def _ov():
        db = TS()
        try: yield db
        finally: db.close()
    app = FastAPI(); app.include_router(pr.router, prefix="/api/projects")
    app.dependency_overrides[get_db] = _ov
    return TestClient(app), monkeypatch


def test_create_with_valid_repo_path(client, tmp_path):
    c, _ = client
    r = c.post("/api/projects", json={"name": "Demo", "repo_path": str(tmp_path)})
    assert r.status_code == 200 and r.json()["repo_path"] == str(tmp_path)


def test_reject_missing_repo_path(client):
    c, _ = client
    r = c.post("/api/projects", json={"name": "Bad", "repo_path": "C:/does/not/exist/xyz"})
    assert r.status_code == 400


def test_discover_finds_git_repos(client, tmp_path):
    c, mp = client
    (tmp_path / "repoA" / ".git").mkdir(parents=True)
    (tmp_path / "repoB" / ".git").mkdir(parents=True)
    (tmp_path / "plain").mkdir()
    mp.setattr(pr.settings, "workspaces_root", str(tmp_path))
    names = {d["name"] for d in c.get("/api/projects/discover").json()}
    assert {"repoA", "repoB"} <= names and "plain" not in names
