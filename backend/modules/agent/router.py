"""Agent endpoints (/api/agent): plan (reply vs action) + run (backend tools)."""
from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from backend.modules.profile.extract import extract_in_background
from . import service, registry

router = APIRouter()


class Msg(BaseModel):
    role: str
    content: str


class PlanIn(BaseModel):
    messages: list[Msg]
    skill: str | None = None


class RunIn(BaseModel):
    tool: str
    args: dict = {}


@router.get("/tools")
def tools():
    return {"tools": registry.TOOLS}


@router.post("/plan")
def plan(body: PlanIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    msgs = [{"role": m.role, "content": m.content} for m in body.messages]
    result = service.plan(db, msgs, skill=body.skill)
    last_user = next((m["content"] for m in reversed(msgs) if m["role"] == "user"), "")
    assistant_text = result.get("text") or result.get("ack") or ""
    if last_user and assistant_text:
        background.add_task(extract_in_background, last_user, assistant_text)
    return result


@router.post("/run")
def run(body: RunIn, db: Session = Depends(get_db)):
    return service.run(db, body.tool, body.args)
