"""Agent endpoints (/api/agent): plan, run, and the autonomous deep-agent job."""
import threading
import uuid

from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from backend.core.llm import ClaudeCliProvider
from backend.modules.chat.router import load_persona, _build_context
from backend.modules.profile.extract import extract_in_background
from . import service, registry

router = APIRouter()

# In-process job store — single-user local app, so a dict is sufficient.
_JOBS: dict[str, dict] = {}


class Msg(BaseModel):
    role: str
    content: str


class PlanIn(BaseModel):
    messages: list[Msg]
    skill: str | None = None
    tier: str | None = None   # None -> route; "smart" | "agent" -> forced tier


class RunIn(BaseModel):
    tool: str
    args: dict = {}


class DeepIn(BaseModel):
    messages: list[Msg]


def _agent_text(prompt: str, context: str) -> str:
    """Indirection so tests can monkeypatch the CLI call."""
    return ClaudeCliProvider().agent_text(prompt, context=context)


def _run_job(job_id: str, prompt: str, context: str) -> None:
    try:
        _JOBS[job_id] = {"status": "done", "text": _agent_text(prompt, context)}
    except Exception as exc:  # noqa: BLE001 — surface a safe message, never raise
        _JOBS[job_id] = {"status": "error", "text": "I ran into a problem with that, sir."}


@router.get("/tools")
def tools():
    return {"tools": registry.TOOLS}


@router.post("/plan")
def plan(body: PlanIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    msgs = [{"role": m.role, "content": m.content} for m in body.messages]
    result = service.plan(db, msgs, skill=body.skill, tier=body.tier)
    last_user = next((m["content"] for m in reversed(msgs) if m["role"] == "user"), "")
    assistant_text = result.get("text") or result.get("ack") or ""
    if last_user and assistant_text:
        background.add_task(extract_in_background, last_user, assistant_text)
    return result


@router.post("/run")
def run(body: RunIn, db: Session = Depends(get_db)):
    return service.run(db, body.tool, body.args)


@router.post("/deep")
def deep(body: DeepIn, db: Session = Depends(get_db)):
    """Start a non-blocking autonomous agent run; returns a job id to poll."""
    msgs = [{"role": m.role, "content": m.content} for m in body.messages]
    prompt = "\n\n".join(f"{m['role']}: {m['content']}" for m in msgs)  # full conversation
    context = f"{load_persona()}\n\n{_build_context(db)}"
    job_id = uuid.uuid4().hex
    _JOBS[job_id] = {"status": "running", "text": ""}
    threading.Thread(target=_run_job, args=(job_id, prompt, context), daemon=True).start()
    return {"job_id": job_id}


@router.get("/deep/{job_id}")
def deep_status(job_id: str):
    return _JOBS.get(job_id, {"status": "error", "text": "unknown job"})
