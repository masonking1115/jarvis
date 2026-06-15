from datetime import date, datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.core.db import Base
from backend.modules.gmail import service, finance_extract, client as gc
from backend.modules.gmail.models import EmailScreening, CardStatement
from backend.modules.finance.models import Liability


def _session():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def _add_financial(db, mid, sender="Chase <no.reply@chase.com>", subject="Your statement is ready"):
    db.add(EmailScreening(message_id=mid, sender=sender, subject=subject, snippet="",
                          received_at=None, category="Financial", importance=45, action="receipt"))
    db.commit()


def test_heuristic_distinguishes_statement_vs_payment():
    s = finance_extract._heuristic(
        {"sender": "Chase <x>", "subject": "Statement ready"},
        "Your statement balance is $500.00. Minimum payment $25 due soon.")
    assert s["kind"] == "statement"
    assert s["balance"] == 500.0
    p = finance_extract._heuristic(
        {"sender": "Apple <x>", "subject": "Payment received"},
        "Thank you for your payment of $153.13.")
    assert p["kind"] == "payment"
    assert p["balance"] is None  # payments never carry a balance


def test_coerce_drops_balance_for_non_statement():
    out = finance_extract._coerce(
        {"kind": "payment", "issuer": "Chase", "balance": 100, "last4": "1234"}, {})
    assert out["kind"] == "payment" and out["balance"] is None
    assert out["last4"] == "1234"


def test_extract_creates_statement_and_liability(monkeypatch):
    db = _session()
    _add_financial(db, "f1")
    monkeypatch.setattr(gc, "search_message_ids", lambda q, limit=40: [])
    monkeypatch.setattr(gc, "get_message_meta", lambda mid: {
        "sender": "Chase <no.reply@chase.com>", "subject": "Your statement is ready", "received_at": None})
    monkeypatch.setattr(gc, "get_message_body", lambda mid, max_chars=4000: "balance $1,234.56")
    monkeypatch.setattr(finance_extract, "extract_statement", lambda meta, body: {
        "kind": "statement", "issuer": "Chase", "last4": "1234", "account_type": "credit_card",
        "balance": 1234.56, "minimum_payment": 35.0, "due_date": date(2026, 7, 1), "apr": 24.99,
    })
    r = service.extract_finances_to_db(db)
    assert r["extracted"] == 1 and r["liabilities_updated"] == 1

    stmts = service.get_email_statements(db)
    assert len(stmts) == 1 and stmts[0]["balance"] == 1234.56

    liab = db.execute(select(Liability).where(Liability.source == "email")).scalars().all()
    assert len(liab) == 1
    assert liab[0].balance == 1234.56
    assert liab[0].due_day_of_month == 1
    assert "Chase" in liab[0].name and "1234" in liab[0].name

    # idempotent — same message isn't re-parsed
    assert service.extract_finances_to_db(db)["extracted"] == 0


def test_payment_email_does_not_create_liability(monkeypatch):
    db = _session()
    _add_financial(db, "p1", subject="Payment received")
    monkeypatch.setattr(gc, "search_message_ids", lambda q, limit=40: [])
    monkeypatch.setattr(gc, "get_message_meta", lambda mid: {
        "sender": "Apple Card <x>", "subject": "Payment received", "received_at": None})
    monkeypatch.setattr(gc, "get_message_body", lambda mid, max_chars=4000: "payment of $153.13")
    monkeypatch.setattr(finance_extract, "extract_statement", lambda meta, body: {
        "kind": "payment", "issuer": "Apple Card", "last4": None, "account_type": "credit_card",
        "balance": None, "minimum_payment": None, "due_date": None, "apr": None,
    })
    r = service.extract_finances_to_db(db)
    assert r["extracted"] == 1 and r["liabilities_updated"] == 0
    assert db.execute(select(Liability)).scalars().all() == []


def test_statement_reminders_flags_manual_card(monkeypatch):
    db = _session()
    # manual card last edited long ago
    amex = Liability(name="Amex", category="credit_card", balance=0.0, source="manual",
                     last_updated=datetime(2020, 1, 1))
    db.add(amex)
    db.add(Liability(name="Chase ••2833", category="credit_card", balance=50.0, source="email"))
    # newer statement email for Amex with NO balance -> should need update
    db.add(CardStatement(message_id="s_amex", issuer="Amex", kind="statement", balance=None,
                         received_at=datetime(2026, 1, 1), due_date=date(2026, 1, 20)))
    # Chase statement WITH balance -> emails_balance, no manual update needed
    db.add(CardStatement(message_id="s_chase", issuer="Chase", kind="statement", balance=50.0,
                         received_at=datetime(2026, 1, 1)))
    db.commit()

    rem = {r["issuer"]: r for r in service.get_statement_reminders(db)}
    assert rem["Amex"]["needs_update"] is True
    assert rem["Amex"]["liability_id"] == amex.id
    assert rem["Amex"]["emails_balance"] is False
    assert rem["Chase"]["emails_balance"] is True
    assert rem["Chase"]["needs_update"] is False
