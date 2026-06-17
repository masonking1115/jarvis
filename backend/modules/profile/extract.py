"""Background fact extraction: turn a conversation turn into UserFact changes."""
from __future__ import annotations

import json
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.llm import get_provider
from . import storage

_INSTRUCTION = (
    "You maintain a long-term memory of durable facts about ONE user.\n"
    "Given the latest conversation turn and the user's CURRENT known facts, "
    "decide what to change. Capture stable things about the user: their goals, "
    "preferences, routines, relationships, situation, dislikes. If the user "
    "explicitly says to remember something, set source to \"explicit\".\n"
    "RULES:\n"
    "- Never store secrets, passwords, API keys, or credential-file contents.\n"
    "- Ignore transient chatter (e.g. 'what's the weather'); store nothing for it.\n"
    "- Do not duplicate an existing fact; update it instead. Archive a fact only "
    "when the user contradicts/retracts it.\n"
    "Respond with ONLY a JSON array (no prose, no code fences). Each item:\n"
    '{"action":"add","category":"goal|preference|routine|relationship|context|dislike|other",'
    '"content":"...","confidence":0.0-1.0,"source":"inferred|explicit"}\n'
    '{"action":"update","id":<existing id>,"category":"...","content":"...","confidence":0.0-1.0}\n'
    '{"action":"archive","id":<existing id>}\n'
    "Return [] if nothing is worth saving."
)


def _render_existing(db: Session) -> str:
    facts = storage.list_facts(db)
    if not facts:
        return "(no facts yet)"
    return "\n".join(f"#{f.id} [{f.category}] {f.content}" for f in facts)


def _parse(raw: str) -> list[dict]:
    s = (raw or "").strip()
    if "```" in s:
        parts = s.split("```")
        s = parts[1] if len(parts) >= 2 else s.replace("```", "")
        if s.lower().startswith("json"):
            s = s[4:]
        s = s.strip()
    i, j = s.find("["), s.rfind("]")
    if i == -1 or j == -1 or j <= i:
        return []
    try:
        obj = json.loads(s[i:j + 1])
        return obj if isinstance(obj, list) else []
    except Exception:  # noqa: BLE001
        return []


def _apply(db: Session, items: list[dict]) -> None:
    for it in items:
        if not isinstance(it, dict):
            continue
        action = it.get("action")
        if action == "add" and it.get("content"):
            storage.create_fact(
                db,
                category=it.get("category", "other"),
                content=str(it["content"]),
                source=it.get("source", "inferred"),
                confidence=float(it.get("confidence", 0.7)),
            )
        elif action == "update" and it.get("id") is not None:
            storage.update_fact(
                db, int(it["id"]),
                category=it.get("category"),
                content=it.get("content"),
                confidence=(float(it["confidence"]) if it.get("confidence") is not None else None),
            )
        elif action == "archive" and it.get("id") is not None:
            storage.archive_fact(db, int(it["id"]))


def extract_and_store(db: Session, user_msg: str, assistant_msg: str) -> None:
    """Extract fact changes from one turn and persist them. Never raises."""
    try:
        provider = get_provider()
        system = _INSTRUCTION + "\n\nCURRENT FACTS:\n" + _render_existing(db)
        turn = f"USER: {user_msg}\nASSISTANT: {assistant_msg}"
        raw = provider.chat(system=system, messages=[{"role": "user", "content": turn}],
                            model=settings.voice_model)
        _apply(db, _parse(raw))
    except Exception:  # noqa: BLE001 — background task must never surface errors
        return


def extract_in_background(user_msg: str, assistant_msg: str) -> None:
    """Entry point for FastAPI BackgroundTasks: owns its own DB session."""
    from backend.core.db import SessionLocal
    db = SessionLocal()
    try:
        extract_and_store(db, user_msg, assistant_msg)
    finally:
        db.close()
