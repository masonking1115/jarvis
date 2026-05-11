from datetime import datetime
from pydantic import BaseModel, ConfigDict


class EventBase(BaseModel):
    title: str
    starts_at: datetime
    ends_at: datetime | None = None
    location: str | None = None
    notes: str | None = None


class EventCreate(EventBase): pass


class EventOut(EventBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
