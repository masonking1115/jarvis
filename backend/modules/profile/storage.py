from __future__ import annotations
from datetime import datetime
from sqlalchemy.orm import Session
from .models import UserFact

_ALLOWED = {"category", "content", "source", "confidence", "status", "pinned"}


def create_fact(db: Session, *, category: str = "other", content: str,
                source: str = "inferred", confidence: float = 0.7,
                pinned: bool = False) -> UserFact:
    f = UserFact(category=category, content=content.strip(), source=source,
                 confidence=confidence, pinned=pinned)
    db.add(f); db.commit(); db.refresh(f)
    return f


def list_facts(db: Session, include_archived: bool = False) -> list[UserFact]:
    q = db.query(UserFact)
    if not include_archived:
        q = q.filter(UserFact.status == "active")
    # pinned first, then confidence desc, then most-recent
    return q.order_by(UserFact.pinned.desc(), UserFact.confidence.desc(),
                      UserFact.created_at.desc()).all()


def get_fact(db: Session, fact_id: int) -> UserFact | None:
    return db.get(UserFact, fact_id)


def update_fact(db: Session, fact_id: int, **fields) -> UserFact | None:
    f = db.get(UserFact, fact_id)
    if not f:
        return None
    for k, v in fields.items():
        if k in _ALLOWED and v is not None:
            setattr(f, k, v)
    f.updated_at = datetime.utcnow()
    db.commit(); db.refresh(f)
    return f


def archive_fact(db: Session, fact_id: int) -> bool:
    f = db.get(UserFact, fact_id)
    if not f:
        return False
    f.status = "archived"; f.updated_at = datetime.utcnow()
    db.commit()
    return True


def get_context(db: Session, cap: int = 50) -> str:
    """Compact block of active facts for the system prompt. Empty if no facts."""
    facts = list_facts(db)[:cap]
    if not facts:
        return ""
    lines = ["# What you know about the user"]
    for f in facts:
        tag = f.category
        meta = "explicit" if f.source == "explicit" else f"inferred, {f.confidence:.1f}"
        lines.append(f"- [{tag}] {f.content} ({meta})")
    return "\n".join(lines)
