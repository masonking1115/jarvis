"""Profile endpoints (/api/profile): CRUD over what JARVIS knows about the user."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from . import storage
from .models import UserFact

router = APIRouter()


class FactIn(BaseModel):
    category: str = "other"
    content: str


class FactPatch(BaseModel):
    category: str | None = None
    content: str | None = None
    confidence: float | None = None
    pinned: bool | None = None
    status: str | None = None


def _ser(f: UserFact) -> dict:
    return {
        "id": f.id, "category": f.category, "content": f.content,
        "source": f.source, "confidence": f.confidence, "status": f.status,
        "pinned": f.pinned,
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "updated_at": f.updated_at.isoformat() if f.updated_at else None,
    }


@router.get("")
def list_facts(db: Session = Depends(get_db)):
    facts = storage.list_facts(db)
    return {"facts": [_ser(f) for f in facts], "count": len(facts)}


@router.post("")
def create(body: FactIn, db: Session = Depends(get_db)):
    # Manual adds are user-stated → explicit, full confidence.
    f = storage.create_fact(db, category=body.category, content=body.content,
                            source="explicit", confidence=1.0)
    return _ser(f)


@router.patch("/{fact_id}")
def patch(fact_id: int, body: FactPatch, db: Session = Depends(get_db)):
    f = storage.update_fact(db, fact_id, **body.model_dump(exclude_none=True))
    if not f:
        raise HTTPException(status_code=404, detail="fact not found")
    return _ser(f)


@router.delete("/{fact_id}")
def delete(fact_id: int, db: Session = Depends(get_db)):
    if not storage.archive_fact(db, fact_id):
        raise HTTPException(status_code=404, detail="fact not found")
    return {"ok": True}
