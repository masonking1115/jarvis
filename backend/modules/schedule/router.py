from datetime import datetime, time, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.core.db import get_db
from .models import Event
from .schemas import EventCreate, EventUpdate, EventOut

router = APIRouter()


def _day_bounds(day: str | None):
    d = datetime.fromisoformat(day).date() if day else datetime.now().date()
    start = datetime.combine(d, time.min)
    return start, start + timedelta(days=1)


@router.get("", response_model=list[EventOut])
def list_events(day: str | None = None, db: Session = Depends(get_db)):
    if day:
        start, end = _day_bounds(day)
        return (
            db.query(Event).filter(Event.starts_at >= start, Event.starts_at < end)
            .order_by(Event.starts_at.asc()).all()
        )
    return db.query(Event).order_by(Event.starts_at.asc()).all()


@router.get("/today", response_model=list[EventOut])
def today(db: Session = Depends(get_db)):
    start, end = _day_bounds(None)
    return (
        db.query(Event).filter(Event.starts_at >= start, Event.starts_at < end)
        .order_by(Event.starts_at.asc()).all()
    )


@router.post("", response_model=EventOut)
def create_event(payload: EventCreate, db: Session = Depends(get_db)):
    e = Event(**payload.model_dump())
    db.add(e); db.commit(); db.refresh(e)
    return e


@router.patch("/{event_id}", response_model=EventOut)
def update_event(event_id: int, payload: EventUpdate, db: Session = Depends(get_db)):
    e = db.get(Event, event_id)
    if not e:
        raise HTTPException(404, "event not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    db.commit(); db.refresh(e)
    return e


@router.delete("/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    e = db.get(Event, event_id)
    if not e:
        raise HTTPException(404, "event not found")
    db.delete(e); db.commit()
    return {"ok": True}
