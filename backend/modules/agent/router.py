"""Agent endpoints (/api/agent): plan (reply vs action) + run (backend tools)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from . import service, registry

router = APIRouter()


class Msg(BaseModel):
    role: str
    content: str


class PlanIn(BaseModel):
    messages: list[Msg]


class RunIn(BaseModel):
    tool: str
    args: dict = {}


@router.get("/tools")
def tools():
    return {"tools": registry.TOOLS}


@router.post("/plan")
def plan(body: PlanIn, db: Session = Depends(get_db)):
    return service.plan(db, [{"role": m.role, "content": m.content} for m in body.messages])


@router.post("/run")
def run(body: RunIn, db: Session = Depends(get_db)):
    return service.run(db, body.tool, body.args)
