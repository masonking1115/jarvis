from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.core.db import get_db
from .models import Goal
from .schemas import GoalCreate, GoalUpdate, GoalOut

router = APIRouter()


@router.get("", response_model=list[GoalOut])
def list_goals(category: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Goal)
    if category:
        q = q.filter(Goal.category == category)
    return q.order_by(Goal.target_date.is_(None), Goal.target_date.asc()).all()


@router.post("", response_model=GoalOut)
def create_goal(payload: GoalCreate, db: Session = Depends(get_db)):
    g = Goal(**payload.model_dump())
    db.add(g); db.commit(); db.refresh(g)
    return g


@router.patch("/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, payload: GoalUpdate, db: Session = Depends(get_db)):
    g = db.get(Goal, goal_id)
    if not g:
        raise HTTPException(404, "goal not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(g, k, v)
    db.commit(); db.refresh(g)
    return g


@router.delete("/{goal_id}")
def delete_goal(goal_id: int, db: Session = Depends(get_db)):
    g = db.get(Goal, goal_id)
    if not g:
        raise HTTPException(404, "goal not found")
    db.delete(g); db.commit()
    return {"ok": True}
