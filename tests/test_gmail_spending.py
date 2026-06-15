from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.db import Base
from backend.modules.gmail import service, finance_extract, client as gc


def _session():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def test_heuristic_purchase_detects_amount():
    p = finance_extract._heuristic_purchase(
        {"sender": "Amazon <x>", "subject": "Your order"}, "Order total $42.10 shipped")
    assert p["is_purchase"] is True
    assert p["amount"] == 42.10
    n = finance_extract._heuristic_purchase(
        {"sender": "Store <x>", "subject": "50% off sale"}, "Shop now, no purchase")
    assert n["is_purchase"] is False


def test_coerce_purchase_requires_positive_amount():
    out = finance_extract._coerce_purchase(
        {"is_purchase": True, "merchant": "X", "amount": 0, "category": "dining"}, {})
    assert out["is_purchase"] is False  # zero amount is not a real purchase
    ok = finance_extract._coerce_purchase(
        {"is_purchase": True, "merchant": "X", "amount": 12.5, "category": "bogus"}, {})
    assert ok["is_purchase"] is True and ok["category"] == "other"


def test_extract_and_summary(monkeypatch):
    db = _session()
    monkeypatch.setattr(gc, "search_message_ids", lambda q, limit=50: ["o1", "o2", "o3"])
    subjects = {"o1": "Amazon order", "o2": "Netflix", "o3": "promo"}
    monkeypatch.setattr(gc, "get_message_meta",
                        lambda mid: {"sender": "x", "subject": subjects[mid], "received_at": None})
    monkeypatch.setattr(gc, "get_message_body", lambda mid, max_chars=4000: "body")

    def fake(meta, body):
        s = meta["subject"]
        if s == "promo":
            return {"is_purchase": False, "merchant": None, "amount": 0.0, "category": "other",
                    "is_subscription": False, "date": None}
        if s == "Netflix":
            return {"is_purchase": True, "merchant": "Netflix", "amount": 15.0,
                    "category": "subscriptions", "is_subscription": True, "date": None}
        return {"is_purchase": True, "merchant": "Amazon", "amount": 25.0,
                "category": "shopping", "is_subscription": False, "date": None}
    monkeypatch.setattr(finance_extract, "extract_purchase", fake)

    r = service.extract_purchases_to_db(db)
    assert r["scanned"] == 3 and r["purchases_added"] == 2  # promo skipped

    s = service.get_spending_summary(db, days=365)
    assert s["total"] == 40.0
    assert s["count"] == 2
    assert s["subscriptions_monthly"] == 15.0
    cats = {c["category"]: c["amount"] for c in s["by_category"]}
    assert cats["shopping"] == 25.0 and cats["subscriptions"] == 15.0
    assert s["top_merchants"][0]["merchant"] == "Amazon"

    # idempotent
    assert service.extract_purchases_to_db(db)["purchases_added"] == 0
