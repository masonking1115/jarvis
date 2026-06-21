"""Helpers for per-project chat threads (project_id 0 = General/main JARVIS)."""
from .models import ChatTurn, get_state
from backend.core.config import settings


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


def estimate_tokens(db, project_id: int = 0) -> int:
    """Rough token count for the thread (chars/4 over turns + any compaction summary)."""
    return sum(len(m["content"]) for m in thread_messages(db, project_id)) // 4


def compact(db, summary: str, project_id: int = 0) -> None:
    state = get_state(db, project_id)
    state.compaction_summary = summary
    db.query(ChatTurn).filter(ChatTurn.project_id == project_id).delete()
    db.commit()


def compact_with_status(db, summary: str, project_id: int = 0) -> None:
    """Compact the thread and, for a real project, store the summary as its
    manager-facing status_summary."""
    compact(db, summary, project_id)
    if project_id:
        from backend.modules.projects.models import Project
        proj = db.get(Project, project_id)
        if proj:
            proj.status_summary = summary
            db.commit()


def maybe_autocompact(db, project_id: int, summarize) -> bool:
    """If the thread is over the token threshold, summarize + compact it.
    `summarize(messages) -> str` is injected so this stays unit-testable."""
    if estimate_tokens(db, project_id) < settings.compact_token_threshold:
        return False
    summary = (summarize(thread_messages(db, project_id)) or "").strip()
    if not summary:
        return False
    compact_with_status(db, summary, project_id)
    return True
