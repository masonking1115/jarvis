from datetime import datetime
from pydantic import BaseModel, ConfigDict


class TxnBase(BaseModel):
    amount: float
    category: str = "misc"
    description: str | None = None
    occurred_at: datetime | None = None


class TxnCreate(TxnBase): pass


class TxnOut(TxnBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    occurred_at: datetime


class FinanceSummary(BaseModel):
    income: float
    expenses: float
    net: float
    count: int
