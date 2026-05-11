from datetime import datetime
from pydantic import BaseModel, ConfigDict


class EventBase(BaseModel):
    title: str
    starts_at: datetime
    ends_at: datetime | None = None
    duration_min: int | None = None
    category: str = "general"
    completed: bool = False
    location: str | None = None
    notes: str | None = None


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    duration_min: int | None = None
    category: str | None = None
    completed: bool | None = None
    location: str | None = None
    notes: str | None = None


class EventOut(EventBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
