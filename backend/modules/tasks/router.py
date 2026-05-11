from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.core.db import get_db
from .models import Task
from .schemas import TaskCreate, TaskUpdate, TaskOut

router = APIRouter()


@router.get("", response_model=list[TaskOut])
def list_tasks(include_done: bool = False, db: Session = Depends(get_db)):
    q = db.query(Task)
    if not include_done:
        q = q.filter(Task.done == False)  # noqa: E712
    return q.order_by(Task.priority.asc(), Task.due_at.is_(None), Task.due_at.asc()).all()


@router.post("", response_model=TaskOut)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)):
    t = Task(**payload.model_dump())
    db.add(t); db.commit(); db.refresh(t)
    return t


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, payload: TaskUpdate, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "task not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    db.commit(); db.refresh(t)
    return t


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "task not found")
    db.delete(t); db.commit()
    return {"ok": True}
