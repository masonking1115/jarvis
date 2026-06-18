"""Helpers for the single persistent chat thread."""
from .models import ChatTurn, get_state


def add_turn(db, role: str, content: str, tier: str | None = None) -> ChatTurn:
    t = ChatTurn(role=role, content=content, tier=tier)
    db.add(t); db.commit(); db.refresh(t)
    return t


def load_turns(db) -> list[ChatTurn]:
    return db.query(ChatTurn).order_by(ChatTurn.created_at.asc(), ChatTurn.id.asc()).all()


def thread_messages(db) -> list[dict]:
    """Messages for the brain: a leading summary note (if compacted) + the turns."""
    state = get_state(db)
    msgs: list[dict] = []
    if state.compaction_summary:
        msgs.append({"role": "assistant",
                     "content": f"(summary of earlier conversation) {state.compaction_summary}"})
    for t in load_turns(db):
        msgs.append({"role": t.role, "content": t.content})
    return msgs


def compact(db, summary: str) -> None:
    state = get_state(db)
    state.compaction_summary = summary
    db.query(ChatTurn).delete()
    db.commit()
