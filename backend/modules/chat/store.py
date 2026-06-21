"""Helpers for per-project chat threads (project_id 0 = General/main JARVIS)."""
from .models import ChatTurn, get_state


def add_turn(db, role: str, content: str, tier: str | None = None, project_id: int = 0) -> ChatTurn:
    t = ChatTurn(role=role, content=content, tier=tier, project_id=project_id)
    db.add(t); db.commit(); db.refresh(t)
    return t


def load_turns(db, project_id: int = 0) -> list[ChatTurn]:
    return (db.query(ChatTurn).filter(ChatTurn.project_id == project_id)
            .order_by(ChatTurn.created_at.asc(), ChatTurn.id.asc()).all())


def thread_messages(db, project_id: int = 0) -> list[dict]:
    state = get_state(db, project_id)
    msgs: list[dict] = []
    if state.compaction_summary:
        msgs.append({"role": "assistant",
                     "content": f"(summary of earlier conversation) {state.compaction_summary}"})
    for t in load_turns(db, project_id):
        msgs.append({"role": t.role, "content": t.content})
    return msgs


def compact(db, summary: str, project_id: int = 0) -> None:
    state = get_state(db, project_id)
    state.compaction_summary = summary
    db.query(ChatTurn).filter(ChatTurn.project_id == project_id).delete()
    db.commit()
