from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Float
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class Workout(Base):
    __tablename__ = "workouts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(64))            # run / lift / peloton / other
    duration_min: Mapped[float] = mapped_column(Float, default=0.0)
    distance_mi: Mapped[float | None] = mapped_column(Float, default=None)
    notes: Mapped[str | None] = mapped_column(String(2000), default=None)
    performed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
