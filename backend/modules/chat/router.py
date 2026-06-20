import json
from datetime import datetime
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Depends, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db, SessionLocal
from backend.core.config import settings
from backend.core.llm import get_provider, ClaudeCliProvider
from backend.modules.tasks.models import Task
from backend.modules.goals.models import Goal
from backend.modules.finance.models import Asset, Liability, Transaction
from backend.modules.profile import storage as profile_storage
from backend.modules.profile.extract import extract_in_background
from backend.modules.chat import store
from backend.modules.chat.models import get_state


router = APIRouter()

# Lazy reference to agent.service — imported at request time to avoid a circular
# import (agent.service imports load_persona from this module at its top level).
# Exposed as a module attribute so tests can monkeypatch it: cr.service.plan.
class _LazyService:
    """Proxy for backend.modules.agent.service, resolved on first attribute access."""
    _mod = None

    def __getattr__(self, name):
        if self._mod is None:
            import importlib
            object.__setattr__(self, "_mod",
                               importlib.import_module("backend.modules.agent.service"))
        return getattr(self._mod, name)

    def __setattr__(self, name, value):
        if name == "_mod":
            object.__setattr__(self, name, value)
        else:
            if self._mod is None:
                import importlib
                object.__setattr__(self, "_mod",
                                   importlib.import_module("backend.modules.agent.service"))
            setattr(self._mod, name, value)


service = _LazyService()


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    provider: str | None = None  # optional override: "anthropic" | "openai"
    voice: bool = False          # tighten replies for spoken output


class ChatResponse(BaseModel):
    reply: str
    provider: str


# Fallback persona used only if jarvis_profile.md is missing/empty.
DEFAULT_PERSONA = (
    "You are Jarvis, the user's personal life-optimization assistant. "
    "Be concise, direct, and proactive. Use the user's tasks and goals (provided below) "
    "as context. When the user asks for plans or recommendations, ground them in that data. "
    "If you don't have relevant data, say so plainly."
)


def _profile_path() -> Path:
    if settings.jarvis_profile_path:
        return Path(settings.jarvis_profile_path)
    # backend/jarvis_profile.md (router.py is backend/modules/chat/router.py)
    return Path(__file__).resolve().parent.parent.parent / "jarvis_profile.md"


def load_persona() -> str:
    """The editable JARVIS profile (guardrails/expectations/skills), read fresh
    each call so edits apply without a restart. Falls back to DEFAULT_PERSONA."""
    try:
        txt = _profile_path().read_text(encoding="utf-8").strip()
        return txt or DEFAULT_PERSONA
    except (FileNotFoundError, OSError):
        return DEFAULT_PERSONA


def _build_context(db: Session) -> str:
    open_tasks = (
        db.query(Task).filter(Task.done == False)  # noqa: E712
        .order_by(Task.priority.asc()).limit(20).all()
    )
    goals = db.query(Goal).order_by(Goal.created_at.desc()).limit(20).all()

    lines = [f"# Context as of {datetime.now().isoformat(timespec='minutes')}", "", "## Open tasks"]
    if open_tasks:
        for t in open_tasks:
            due = f" (due {t.due_at.date()})" if t.due_at else ""
            lines.append(f"- [P{t.priority}] {t.title}{due}")
    else:
        lines.append("- (none)")

    lines += ["", "## Goals"]
    if goals:
        for g in goals:
            tgt = f" — target {g.target_date.date()}" if g.target_date else ""
            lines.append(f"- [{g.category}] {g.title} ({int(g.progress * 100)}%){tgt}")
    else:
        lines.append("- (none)")
    # Finance snapshot (includes Robinhood-synced holdings)
    assets = db.query(Asset).order_by(Asset.value.desc()).all()
    liabilities = db.query(Liability).all()
    assets_total = sum(a.value or 0 for a in assets)
    liab_total = sum(l.balance or 0 for l in liabilities)
    cash_total = sum(a.value or 0 for a in assets if a.category == "cash")
    lines += ["", "## Finance"]
    lines.append(
        f"- Net worth: ${assets_total - liab_total:,.0f} "
        f"(assets ${assets_total:,.0f}, debts ${liab_total:,.0f}, cash ${cash_total:,.0f})"
    )
    top = [a for a in assets if a.category in ("stocks", "crypto")][:5]
    if top:
        lines.append("- Top positions:")
        for a in top:
            tk = f" {a.ticker}" if a.ticker else ""
            lines.append(f"  - {a.name}{tk}: ${a.value:,.0f}")
    recent = db.query(Transaction).order_by(Transaction.occurred_at.desc()).limit(3).all()
    if recent:
        lines.append("- Recent transactions:")
        for t in recent:
            sign = "-" if t.amount < 0 else "+"
            lines.append(f"  - {t.occurred_at.date()} {sign}${abs(t.amount):,.0f} {t.category}")
    facts = profile_storage.get_context(db)
    if facts:
        lines += ["", facts]
    return "\n".join(lines)


@router.post("", response_model=ChatResponse)
def chat(req: ChatRequest, background: BackgroundTasks, db: Session = Depends(get_db)):
    provider = get_provider(req.provider)
    context = _build_context(db)
    system = f"{load_persona()}\n\n{context}"
    if req.voice:
        system += ("\n\nRespond briefly and conversationally, as spoken dialogue — "
                   "at most 2-3 sentences, no markdown, no lists, no emojis.")
    msgs = [{"role": m.role, "content": m.content} for m in req.messages]
    # Voice replies use a faster model (lower latency); typed chat keeps the default.
    model = settings.voice_model if req.voice else None
    reply = provider.chat(system=system, messages=msgs, model=model)
    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
    if last_user and reply:
        background.add_task(extract_in_background, last_user, reply)
    return ChatResponse(reply=reply, provider=provider.name)


@router.get("/briefing", response_model=ChatResponse)
def daily_briefing(db: Session = Depends(get_db)):
    """One-shot morning briefing — pulls today's data, asks the LLM to summarize."""
    provider = get_provider()
    context = _build_context(db)
    system = f"{load_persona()}\n\n{context}"
    user_msg = (
        "Give me a concise morning briefing: top 3 priorities for today based on my tasks and goals, "
        "any deadlines I should know about, and one focused recommendation. Where it's relevant, tie "
        "advice to what you know about me (my goals, preferences, routines). Keep it under 200 words."
    )
    reply = provider.chat(system=system, messages=[{"role": "user", "content": user_msg}])
    return ChatResponse(reply=reply, provider=provider.name)


class ModelIn(BaseModel):
    tier: Literal["fast", "smart", "agent"]


class ModeIn(BaseModel):
    mode: Literal["", "brainstorm"]


def _summarize(messages: list[dict]) -> str:
    """Summarize the thread with the fast provider (indirection for tests)."""
    provider = get_provider()
    sys = ("Summarize this conversation so it can continue with full context: open "
           "threads, decisions, the user's surfaced goals/preferences, and any pending todos. "
           "Be concise; no preamble.")
    return provider.chat(system=sys, messages=messages, model=settings.voice_model).strip()


@router.get("/thread")
def thread(db: Session = Depends(get_db)):
    state = get_state(db)
    turns = store.load_turns(db)
    messages = []
    if state.compaction_summary:
        messages.append({"role": "assistant",
                         "content": f"(summary of earlier conversation) {state.compaction_summary}",
                         "tier": None})
    messages.extend([{"role": t.role, "content": t.content, "tier": t.tier} for t in turns])
    return {
        "messages": messages,
        "tier": state.tier,
        "mode": state.mode,
    }


@router.post("/model")
def set_model(body: ModelIn, db: Session = Depends(get_db)):
    state = get_state(db)
    state.tier = body.tier
    db.commit()
    return {"tier": state.tier}


@router.post("/mode")
def set_mode(body: ModeIn, db: Session = Depends(get_db)):
    state = get_state(db)
    state.mode = body.mode
    db.commit()
    return {"mode": state.mode}


@router.post("/compact")
def compact(db: Session = Depends(get_db)):
    summary = _summarize(store.thread_messages(db)) or "(nothing to summarize yet)"
    store.compact(db, summary)
    return {"summary": summary}


class StreamIn(BaseModel):
    text: str
    tier: str | None = None   # overrides the sticky tier for this message


def _agent_stream(prompt: str, context: str = "", session_id: str | None = None, **kw):
    """Indirection so tests can monkeypatch the CLI streaming call."""
    yield from ClaudeCliProvider().agent_stream(prompt, context=context, session_id=session_id)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.post("/stream")
def stream(body: StreamIn):
    # Own session: a StreamingResponse outlives the request scope, so we manage it here.
    def gen():
        db = SessionLocal()
        try:
            store.add_turn(db, "user", body.text)
            state = get_state(db)
            tier = body.tier or state.tier
            msgs = store.thread_messages(db)
            # Give the chat planner the data snapshot so fast/smart tiers can answer
            # data questions ("what's my monthly expenditure?") instead of punting.
            result = service.plan(db, msgs, tier=tier, extra_context=_build_context(db))
            kind = result.get("kind")
            assistant_text = ""
            todos = None

            # Frontend-only nav actions (navigate/open_flyover) don't answer a typed
            # question — escalate to the agent, which can actually compute/look it up.
            if kind == "action" and result.get("tool") in ("navigate", "open_flyover"):
                kind = "escalate"

            if kind == "escalate" or tier == "agent":
                prompt = "\n\n".join(f"{m['role']}: {m['content']}" for m in msgs)
                context = f"{load_persona()}\n\n{_build_context(db)}"
                for ev in _agent_stream(prompt, context=context, session_id=state.agent_session_id or None):
                    if ev["type"] == "session":
                        state.agent_session_id = ev["session_id"]
                        db.commit()
                        continue                      # internal — don't send to the client
                    if ev["type"] == "text":
                        assistant_text += ev["text"]
                    elif ev["type"] == "todos":
                        todos = ev["todos"]
                    yield _sse(ev)
            elif kind == "action":
                out = service.run(db, result["tool"], result.get("args"))
                assistant_text = out.get("text", "")
                # let the UI optionally surface the action it ran
                yield _sse({"type": "action", "name": result["tool"]})
                yield _sse({"type": "text", "text": assistant_text})
                yield _sse({"type": "done", "text": assistant_text})
            else:  # reply (and skill, which returns reply/action already resolved)
                assistant_text = result.get("text", "") or result.get("ack", "")
                yield _sse({"type": "text", "text": assistant_text})
                yield _sse({"type": "done", "text": assistant_text})

            store.add_turn(db, "assistant", assistant_text, tier=tier)
        except Exception:  # noqa: BLE001 — never leak; close the stream cleanly
            yield _sse({"type": "error", "text": "I ran into a problem with that, sir."})
            yield _sse({"type": "done", "text": ""})
        finally:
            db.close()

    return StreamingResponse(gen(), media_type="text/event-stream")
