from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from backend.core.config import settings
from backend.core.llm import get_provider
from backend.modules.tasks.models import Task
from backend.modules.goals.models import Goal
from backend.modules.finance.models import Asset, Liability, Transaction
from backend.modules.profile import storage as profile_storage


router = APIRouter()


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
def chat(req: ChatRequest, db: Session = Depends(get_db)):
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
    return ChatResponse(reply=reply, provider=provider.name)


@router.get("/briefing", response_model=ChatResponse)
def daily_briefing(db: Session = Depends(get_db)):
    """One-shot morning briefing — pulls today's data, asks the LLM to summarize."""
    provider = get_provider()
    context = _build_context(db)
    system = f"{load_persona()}\n\n{context}"
    user_msg = (
        "Give me a concise morning briefing: top 3 priorities for today based on my tasks and goals, "
        "any deadlines I should know about, and one focused recommendation. Keep it under 200 words."
    )
    reply = provider.chat(system=system, messages=[{"role": "user", "content": user_msg}])
    return ChatResponse(reply=reply, provider=provider.name)
