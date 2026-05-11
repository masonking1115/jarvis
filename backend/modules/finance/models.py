from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Float
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    amount: Mapped[float] = mapped_column(Float)         # negative = expense, positive = income
    category: Mapped[str] = mapped_column(String(64), default="misc")
    description: Mapped[str | None] = mapped_column(String(500), default=None)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
