from datetime import datetime, time, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.core.db import get_db
from .models import Event
from .schemas import EventCreate, EventOut

router = APIRouter()


@router.get("", response_model=list[EventOut])
def list_events(day: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Event)
    if day:  # YYYY-MM-DD
        d = datetime.fromisoformat(day).date()
        start = datetime.combine(d, time.min)
        end = start + timedelta(days=1)
        q = q.filter(Event.starts_at >= start, Event.starts_at < end)
    return q.order_by(Event.starts_at.asc()).all()


@router.get("/today", response_model=list[EventOut])
def today(db: Session = Depends(get_db)):
    d = datetime.now().date()
    start = datetime.combine(d, time.min)
    end = start + timedelta(days=1)
    return (
        db.query(Event)
        .filter(Event.starts_at >= start, Event.starts_at < end)
        .order_by(Event.starts_at.asc())
        .all()
    )


@router.post("", response_model=EventOut)
def create_event(payload: EventCreate, db: Session = Depends(get_db)):
    e = Event(**payload.model_dump())
    db.add(e); db.commit(); db.refresh(e)
    return e


@router.delete("/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    e = db.get(Event, event_id)
    if not e:
        raise HTTPException(404, "event not found")
    db.delete(e); db.commit()
    return {"ok": True}
