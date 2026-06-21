"""Projects module — DB-backed.

Stores engineering / personal projects with an optional `notion_url` pointing
to a Notion page that's intended to be managed by an AI agent later.

A small seed runs on first load if the table is empty so the dashboard still
has something to show out of the box.
"""
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.db import get_db
from .models import Project
from .schemas import ProjectCreate, ProjectUpdate, ProjectOut

router = APIRouter()


_SEED = [
    {"name": "Tesla AI Side-Build",   "status": "active", "progress": 0.42},
    {"name": "Glide Slope Receiver",  "status": "active", "progress": 0.68},
    {"name": "AGC System",            "status": "paused", "progress": 0.20},
    {"name": "FPGA SDR Research",     "status": "active", "progress": 0.55},
]


def _seed_if_empty(db: Session) -> None:
    if db.query(Project).first() is not None:
        return
    for row in _SEED:
        db.add(Project(**row))
    db.commit()


def _validate_repo_path(path: str | None):
    if path and not os.path.isdir(path):
        raise HTTPException(400, "repo_path is not an existing directory")


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    _seed_if_empty(db)
    return db.query(Project).order_by(Project.created_at.asc()).all()


@router.post("", response_model=ProjectOut)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    _validate_repo_path(payload.repo_path)
    p = Project(**payload.model_dump())
    db.add(p); db.commit(); db.refresh(p)
    return p


# discover MUST be above /{project_id} so it isn't captured by the path param
@router.get("/discover")
def discover():
    root = settings.workspaces_root
    found = []
    if os.path.isdir(root):
        for name in sorted(os.listdir(root)):
            p = os.path.join(root, name)
            if os.path.isdir(os.path.join(p, ".git")):
                found.append({"name": name, "path": p})
    return found


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)):
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "project not found")
    updates = payload.model_dump(exclude_unset=True)
    _validate_repo_path(updates.get("repo_path"))
    for k, v in updates.items():
        setattr(p, k, v)
    db.commit(); db.refresh(p)
    return p


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "project not found")
    db.delete(p); db.commit()
    return {"ok": True}
