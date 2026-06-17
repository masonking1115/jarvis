from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class UserFact(Base):
    """One discrete thing JARVIS knows about the user.

    Facts accumulate over time (auto-extracted from conversation or stated
    explicitly), are injected into chat + the action planner, and are managed
    by the user on the Profile page. "Forgetting" is a soft delete (status).
    Local-only; never sent anywhere without explicit user confirmation.
    """
    __tablename__ = "user_facts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(32), default="other", index=True)
    # preference | goal | routine | relationship | context | dislike | other
    content: Mapped[str] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(16), default="inferred")   # explicit | inferred
    confidence: Mapped[float] = mapped_column(Float, default=0.7)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)  # active | archived
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
