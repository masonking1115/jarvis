from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.db import Base
from backend.modules.gmail import service, screening, client as gc


def _session():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def test_heuristic_categories():
    assert screening._heuristic({"subject": "Your receipt", "snippet": "order #123"})["category"] == "Financial"
    assert screening._heuristic({"subject": "Big Sale", "snippet": "unsubscribe here"})["category"] == "Newsletter"
    assert screening._heuristic({"subject": "Can you call?", "snippet": "need help"})["category"] == "Needs reply"
    assert screening._heuristic({"subject": "Notes", "snippet": "fyi"})["category"] == "Other"


def test_priority_rule_bumps_importance():
    base = {"category": "Other", "importance": 30, "summary": "s", "action": "fyi"}
    meta = {"sender": "boss@company.com", "subject": "x", "snippet": "y"}
    out = screening._apply_rules(base, meta, [{"kind": "sender", "value": "boss@company.com", "weight": 40}])
    assert out["importance"] == 70
    # non-matching rule leaves it unchanged
    out2 = screening._apply_rules(base, meta, [{"kind": "keyword", "value": "invoice", "weight": 40}])
    assert out2["importance"] == 30


def test_parse_llm_valid_and_fallback():
    meta = {"subject": "Sub"}
    good = '{"category":"Important","importance":80,"summary":"ok","action":"fyi"}'
    assert screening._parse_llm(good, meta)["category"] == "Important"
    assert screening._parse_llm(good, meta)["importance"] == 80
    res = screening._parse_llm("not json at all", meta)
    assert res["category"] in screening.CATEGORIES


def test_sync_screens_new_and_skips_existing(monkeypatch):
    db = _session()
    monkeypatch.setattr(gc, "list_inbox_ids", lambda limit=50: [{"id": "m1"}, {"id": "m2"}])
    metas = {
        "m1": {"id": "m1", "thread_id": "t1", "sender": "a@x.com", "subject": "hi?",
               "snippet": "can you review?", "received_at": None},
        "m2": {"id": "m2", "thread_id": "t2", "sender": "news@promo.com", "subject": "50% off",
               "snippet": "unsubscribe", "received_at": None},
    }
    monkeypatch.setattr(gc, "get_message_meta", lambda mid: metas[mid])
    monkeypatch.setattr(screening, "screen_email",
                        lambda meta, rules: {"category": "Other", "importance": 30, "summary": "s", "action": "fyi"})

    r1 = service.sync_to_db(db)
    assert r1["screened_new"] == 2
    r2 = service.sync_to_db(db)  # idempotent — already screened
    assert r2["screened_new"] == 0
    assert r2["skipped_existing"] == 2
    assert len(service.get_digest(db)) == 2


def test_rules_crud():
    db = _session()
    rule = service.add_rule(db, "sender", "boss@co.com", 50)
    assert rule["kind"] == "sender" and rule["weight"] == 50
    assert len(service.list_rules(db)) == 1
    service.delete_rule(db, rule["id"])
    assert service.list_rules(db) == []
