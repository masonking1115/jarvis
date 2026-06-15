import io
from datetime import date

import openpyxl
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.core.db import Base
from backend.modules.gmail import service, finance_extract, file_import
from backend.modules.finance.models import Liability


def _session():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def test_parse_csv():
    blob = b"Date,Description,Amount\n2026-06-01,Coffee Shop,5.00\n2026-06-02,Netflix,15.00\n"
    text = file_import.parse_file("export.csv", blob)
    assert "Coffee Shop" in text and "Netflix" in text


def test_parse_xlsx():
    wb = openpyxl.Workbook(); ws = wb.active
    ws.append(["Date", "Description", "Amount"])
    ws.append(["2026-06-01", "Coffee Shop", "5.00"])
    buf = io.BytesIO(); wb.save(buf)
    text = file_import.parse_file("export.xlsx", buf.getvalue())
    assert "Coffee Shop" in text


def test_unsupported_file():
    try:
        file_import.parse_file("photo.png", b"\x89PNG\r\n\x1a\n notreallytext")
        assert False, "expected UnsupportedFile"
    except file_import.UnsupportedFile:
        pass


def test_import_transactions_and_balance(monkeypatch):
    db = _session()
    liab = Liability(name="Amex", category="credit_card", balance=0.0, source="manual")
    db.add(liab); db.commit()

    monkeypatch.setattr(finance_extract, "extract_transactions", lambda text: {
        "balance": 1234.0,
        "transactions": [
            {"date": date(2026, 6, 1), "merchant": "Coffee", "amount": 5.0,
             "category": "dining", "is_subscription": False},
            {"date": date(2026, 6, 2), "merchant": "Netflix", "amount": 15.0,
             "category": "subscriptions", "is_subscription": True},
        ],
    })

    r = service.import_transactions_to_db(db, "amex.csv", b"date,desc,amt\n", liability_id=liab.id)
    assert r["parsed"] == 2 and r["transactions_added"] == 2
    assert r["balance_updated"] is True
    db.refresh(liab)
    assert liab.balance == 1234.0

    # re-import same file -> deduped, nothing added
    assert service.import_transactions_to_db(db, "amex.csv", b"date,desc,amt\n",
                                             liability_id=liab.id)["transactions_added"] == 0

    # transactions flow into the spending summary
    s = service.get_spending_summary(db, days=3650)
    assert s["count"] == 2
    assert s["subscriptions_monthly"] == 15.0


def test_card_spending_groups_by_card(monkeypatch):
    db = _session()
    liab = Liability(name="Chase", category="credit_card", balance=0.0, source="manual")
    db.add(liab); db.commit()
    monkeypatch.setattr(finance_extract, "extract_transactions", lambda text: {
        "balance": 100.0,
        "transactions": [
            {"date": date(2026, 6, 1), "merchant": "Store A", "amount": 5.0, "category": "dining", "is_subscription": False},
            {"date": date(2026, 6, 2), "merchant": "Store B", "amount": 9.0, "category": "shopping", "is_subscription": False},
        ],
    })
    service.import_transactions_to_db(db, "chase.csv", b"x", liability_id=liab.id)
    cards = service.get_card_spending(db)
    chase = next(c for c in cards if c["liability_id"] == liab.id)
    assert chase["name"] == "Chase"
    assert len(chase["transactions"]) == 2
    assert {t["merchant"] for t in chase["transactions"]} == {"Store A", "Store B"}
