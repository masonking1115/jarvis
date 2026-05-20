from datetime import datetime, date
from pydantic import BaseModel, ConfigDict


# ---------- Transactions ----------
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


# ---------- Income sources ----------
class IncomeBase(BaseModel):
    name: str
    amount: float
    is_gross: bool = True
    frequency: str = "biweekly"
    next_pay_date: date | None = None
    notes: str | None = None
    active: bool = True


class IncomeCreate(IncomeBase): pass


class IncomeUpdate(BaseModel):
    name: str | None = None
    amount: float | None = None
    is_gross: bool | None = None
    frequency: str | None = None
    next_pay_date: date | None = None
    notes: str | None = None
    active: bool | None = None


class IncomeOut(IncomeBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime


# ---------- Assets ----------
class AssetBase(BaseModel):
    name: str
    category: str = "cash"
    value: float = 0.0
    ticker: str | None = None
    shares: float | None = None
    cost_basis: float | None = None
    notes: str | None = None


class AssetCreate(AssetBase): pass


class AssetUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    value: float | None = None
    ticker: str | None = None
    shares: float | None = None
    cost_basis: float | None = None
    notes: str | None = None


class AssetOut(AssetBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    last_updated: datetime
    created_at: datetime


# ---------- Liabilities ----------
class LiabilityBase(BaseModel):
    name: str
    category: str = "credit_card"
    balance: float = 0.0
    apr: float | None = None
    minimum_payment: float | None = None
    due_day_of_month: int | None = None
    notes: str | None = None


class LiabilityCreate(LiabilityBase): pass


class LiabilityUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    balance: float | None = None
    apr: float | None = None
    minimum_payment: float | None = None
    due_day_of_month: int | None = None
    notes: str | None = None


class LiabilityOut(LiabilityBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    last_updated: datetime
    created_at: datetime


# ---------- Aggregates ----------
class FinanceSummary(BaseModel):
    """Backwards-compatible: transaction-derived rollups."""
    income: float
    expenses: float
    net: float
    count: int


class CategoryTotal(BaseModel):
    category: str
    value: float


class IncomeProjection(BaseModel):
    """Projected monthly income from active income sources."""
    monthly_gross: float
    monthly_net: float
    next_pay_date: date | None
    next_pay_amount: float | None
    days_to_next_pay: int | None


class FinanceOverview(BaseModel):
    """The big picture — what the dashboard finance card cares about."""
    net_worth: float
    assets_total: float
    liabilities_total: float
    cash_total: float
    investments_total: float
    debt_minimum_payment_total: float
    asset_breakdown: list[CategoryTotal]
    liability_breakdown: list[CategoryTotal]
    income: IncomeProjection
    monthly_expenses: float          # rolling 30-day from transactions
    monthly_savings_est: float       # income.monthly_net - monthly_expenses
    transaction_summary: FinanceSummary
