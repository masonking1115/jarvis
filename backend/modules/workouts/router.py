from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.core.db import get_db
from .models import Workout
from .schemas import WorkoutCreate, WorkoutOut

router = APIRouter()


@router.get("", response_model=list[WorkoutOut])
def list_workouts(limit: int = 50, db: Session = Depends(get_db)):
    return db.query(Workout).order_by(Workout.performed_at.desc()).limit(limit).all()


@router.post("", response_model=WorkoutOut)
def create_workout(payload: WorkoutCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    if data.get("performed_at") is None:
        data["performed_at"] = datetime.utcnow()
    w = Workout(**data)
    db.add(w); db.commit(); db.refresh(w)
    return w


@router.delete("/{workout_id}")
def delete_workout(workout_id: int, db: Session = Depends(get_db)):
    w = db.get(Workout, workout_id)
    if not w:
        raise HTTPException(404, "workout not found")
    db.delete(w); db.commit()
    return {"ok": True}
