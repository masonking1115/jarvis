from datetime import datetime, date
from sqlalchemy import String, Integer, DateTime, Date, Float, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    amount: Mapped[float] = mapped_column(Float)         # negative = expense, positive = income
    category: Mapped[str] = mapped_column(String(64), default="misc")
    description: Mapped[str | None] = mapped_column(String(500), default=None)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    source: Mapped[str] = mapped_column(String(32), default="manual")        # manual | robinhood
    external_id: Mapped[str | None] = mapped_column(String(128), default=None)


class IncomeSource(Base):
    __tablename__ = "income_sources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))                                   # "Engineering Salary"
    amount: Mapped[float] = mapped_column(Float)                                     # amount per pay period
    is_gross: Mapped[bool] = mapped_column(Boolean, default=True)                    # gross vs take-home
    frequency: Mapped[str] = mapped_column(String(32), default="biweekly")           # weekly | biweekly | semimonthly | monthly | annual | irregular
    next_pay_date: Mapped[date | None] = mapped_column(Date, default=None)
    notes: Mapped[str | None] = mapped_column(String(500), default=None)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))                                    # "Schwab Brokerage" / "VTI"
    category: Mapped[str] = mapped_column(String(32), default="cash")                 # cash | stocks | crypto | retirement | real_estate | vehicle | other
    value: Mapped[float] = mapped_column(Float, default=0.0)                          # current $ value
    ticker: Mapped[str | None] = mapped_column(String(16), default=None)              # for stocks/crypto positions
    shares: Mapped[float | None] = mapped_column(Float, default=None)
    cost_basis: Mapped[float | None] = mapped_column(Float, default=None)             # what you paid
    notes: Mapped[str | None] = mapped_column(String(500), default=None)
    last_updated: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    source: Mapped[str] = mapped_column(String(32), default="manual")        # manual | robinhood
    external_id: Mapped[str | None] = mapped_column(String(128), default=None)


class Liability(Base):
    __tablename__ = "liabilities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))                                    # "Chase Sapphire" / "Sallie Mae"
    category: Mapped[str] = mapped_column(String(32), default="credit_card")          # credit_card | student | auto | mortgage | personal | other
    balance: Mapped[float] = mapped_column(Float, default=0.0)
    apr: Mapped[float | None] = mapped_column(Float, default=None)                    # interest rate %
    minimum_payment: Mapped[float | None] = mapped_column(Float, default=None)
    due_day_of_month: Mapped[int | None] = mapped_column(Integer, default=None)
    notes: Mapped[str | None] = mapped_column(String(500), default=None)
    last_updated: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    source: Mapped[str] = mapped_column(String(32), default="manual")        # manual | email
    external_id: Mapped[str | None] = mapped_column(String(128), default=None)  # issuer:last4 for email-sourced
