from datetime import datetime
from sqlalchemy import String, Integer, Float, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class FlyoverSettings(Base):
    """Single-row settings for the Flyover view (the active location)."""
    __tablename__ = "flyover_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    address: Mapped[str | None] = mapped_column(String(300), default=None)
    lat: Mapped[float | None] = mapped_column(Float, default=None)
    lng: Mapped[float | None] = mapped_column(Float, default=None)
    units: Mapped[str] = mapped_column(String(16), default="imperial")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


def get_or_create(db) -> "FlyoverSettings":
    row = db.get(FlyoverSettings, 1)
    if row is None:
        row = FlyoverSettings(id=1)
        db.add(row); db.commit(); db.refresh(row)
    return row
