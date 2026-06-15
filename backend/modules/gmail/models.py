from datetime import datetime, date
from sqlalchemy import String, Integer, DateTime, Date, Float, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class EmailScreening(Base):
    """One screened inbox message. We store metadata + the LLM's triage result,
    never the full body (that stays in Gmail, fetched on demand). Keyed on the
    Gmail message_id so re-runs are idempotent."""
    __tablename__ = "email_screenings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    thread_id: Mapped[str | None] = mapped_column(String(64), default=None)
    sender: Mapped[str | None] = mapped_column(String(320), default=None)
    subject: Mapped[str | None] = mapped_column(String(500), default=None)
    snippet: Mapped[str | None] = mapped_column(Text, default=None)
    received_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    category: Mapped[str] = mapped_column(String(32), default="Other")     # Needs reply | Important | Financial | Newsletter | Other
    importance: Mapped[int] = mapped_column(Integer, default=0)            # 0-100
    summary: Mapped[str | None] = mapped_column(String(500), default=None)
    action: Mapped[str | None] = mapped_column(String(32), default=None)   # needs_reply | fyi | receipt | archive | none
    screened_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SuppressedSender(Base):
    """Senders we've unsubscribed from or blocked. The screening loop skips them
    and they're hidden from Sources/digest — so they don't keep reappearing."""
    __tablename__ = "email_suppressed_senders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    reason: Mapped[str] = mapped_column(String(16), default="unsubscribed")  # unsubscribed | blocked
    filter_id: Mapped[str | None] = mapped_column(String(128), default=None)  # Gmail filter id (block only), for undo
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CardStatement(Base):
    """A financial fact parsed from one email (statement balance, payment, etc).
    Powers the 'Debts from email' panel and feeds Liability upserts. Keyed on the
    source Gmail message_id so re-runs are idempotent."""
    __tablename__ = "email_card_statements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    issuer: Mapped[str | None] = mapped_column(String(120), default=None)
    last4: Mapped[str | None] = mapped_column(String(8), default=None)
    account_type: Mapped[str] = mapped_column(String(16), default="credit_card")  # credit_card | loan | other
    kind: Mapped[str] = mapped_column(String(16), default="other")                # statement | payment | other
    balance: Mapped[float | None] = mapped_column(Float, default=None)
    minimum_payment: Mapped[float | None] = mapped_column(Float, default=None)
    due_date: Mapped[date | None] = mapped_column(Date, default=None)
    apr: Mapped[float | None] = mapped_column(Float, default=None)
    subject: Mapped[str | None] = mapped_column(String(500), default=None)
    received_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    detected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Purchase(Base):
    """A spending event parsed from a receipt / order-confirmation email.
    Powers the Spending dashboard. Keyed on source message_id (idempotent)."""
    __tablename__ = "email_purchases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    liability_id: Mapped[int | None] = mapped_column(Integer, default=None, index=True)  # which card (imports)
    merchant: Mapped[str | None] = mapped_column(String(160), default=None)
    amount: Mapped[float] = mapped_column(Float, default=0.0)              # positive = spend
    category: Mapped[str] = mapped_column(String(24), default="other")    # groceries|dining|shopping|subscriptions|travel|transport|entertainment|bills|health|other
    is_subscription: Mapped[bool] = mapped_column(Boolean, default=False)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    subject: Mapped[str | None] = mapped_column(String(500), default=None)
    detected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class EmailBrief(Base):
    """One generated daily summary of inbox activity, keyed by day (YYYY-MM-DD)."""
    __tablename__ = "email_briefs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    summary: Mapped[str] = mapped_column(Text)
    stats: Mapped[str | None] = mapped_column(Text, default=None)   # JSON blob of counts
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PriorityRule(Base):
    """User-defined 'define once' rules that bump importance — VIP senders or
    keywords. Applied deterministically every cycle (so they work even without
    an LLM key) and also fed into the screening prompt as hints."""
    __tablename__ = "email_priority_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))            # sender | keyword
    value: Mapped[str] = mapped_column(String(200))
    weight: Mapped[int] = mapped_column(Integer, default=25)  # importance bump, 0-100
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
