from datetime import datetime
from pydantic import BaseModel, ConfigDict


class WorkoutBase(BaseModel):
    kind: str
    duration_min: float = 0.0
    distance_mi: float | None = None
    notes: str | None = None
    performed_at: datetime | None = None


class WorkoutCreate(WorkoutBase): pass


class WorkoutOut(WorkoutBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    performed_at: datetime
