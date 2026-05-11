from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Float
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class Goal(Base):
    __tablename__ = "goals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    category: Mapped[str] = mapped_column(String(64), default="general")  # finance/fitness/career/...
    notes: Mapped[str | None] = mapped_column(String(2000), default=None)
    progress: Mapped[float] = mapped_column(Float, default=0.0)  # 0..1
    target_date: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
