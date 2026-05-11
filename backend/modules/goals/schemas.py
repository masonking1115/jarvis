from datetime import datetime
from pydantic import BaseModel, ConfigDict


class GoalBase(BaseModel):
    title: str
    category: str = "general"
    notes: str | None = None
    progress: float = 0.0
    target_date: datetime | None = None


class GoalCreate(GoalBase): pass


class GoalUpdate(BaseModel):
    title: str | None = None
    category: str | None = None
    notes: str | None = None
    progress: float | None = None
    target_date: datetime | None = None


class GoalOut(GoalBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
