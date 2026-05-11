from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    starts_at: Mapped[datetime] = mapped_column(DateTime)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    duration_min: Mapped[int | None] = mapped_column(Integer, default=None)
    category: Mapped[str] = mapped_column(String(32), default="general")  # workout, deep_work, meal, study, review, meeting, routine, personal, general
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    location: Mapped[str | None] = mapped_column(String(200), default=None)
    notes: Mapped[str | None] = mapped_column(String(2000), default=None)
