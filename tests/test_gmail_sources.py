from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.db import Base
from backend.modules.gmail import service, screening, client as gc
from backend.modules.gmail.models import EmailScreening


def _session():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def _add(db, mid, sender, when):
    db.add(EmailScreening(message_id=mid, sender=sender, subject="s", snippet="x",
                          received_at=when, category="Newsletter", importance=15, action="archive"))
    db.commit()


def test_parse_email_addr():
    assert gc.parse_email_addr("Robinhood <noreply@robinhood.com>") == "noreply@robinhood.com"
    assert gc.parse_email_addr("plain@x.com") == "plain@x.com"
    assert gc.parse_email_addr("No Address Here") == ""
    assert gc.parse_email_addr(None) == ""


def test_unsubscribe_info_parsing(monkeypatch):
    monkeypatch.setattr(gc, "_bearer_get", lambda path: {
        "payload": {"headers": [
            {"name": "List-Unsubscribe", "value": "<https://x.com/u?id=1>, <mailto:unsub@x.com>"},
            {"name": "List-Unsubscribe-Post", "value": "List-Unsubscribe=One-Click"},
        ]}
    })
    info = gc.get_unsubscribe_info("m1")
    assert info["method"] == "one_click"
    assert info["https_url"] == "https://x.com/u?id=1"
    assert info["mailto"] == "mailto:unsub@x.com"


def test_get_sources_groups_by_sender():
    db = _session()
    _add(db, "a1", "Promo <deals@store.com>", datetime(2026, 6, 1))
    _add(db, "a2", "Promo <deals@store.com>", datetime(2026, 6, 2))
    _add(db, "b1", "News <news@other.com>", datetime(2026, 6, 1))
    sources = service.get_sources(db)
    by_email = {s["email"]: s for s in sources}
    assert by_email["deals@store.com"]["count"] == 2
    assert by_email["news@other.com"]["count"] == 1
    assert sources[0]["email"] == "deals@store.com"  # sorted by count desc


def test_block_source_filters_and_clears(monkeypatch):
    db = _session()
    _add(db, "a1", "Promo <deals@store.com>", datetime(2026, 6, 1))
    _add(db, "a2", "Promo <deals@store.com>", datetime(2026, 6, 2))
    monkeypatch.setattr(gc, "create_block_filter", lambda email: "filter123")
    monkeypatch.setattr(gc, "trash_existing_from", lambda email, cap=100: 5)
    r = service.block_source(db, "deals@store.com")
    assert r["filter_id"] == "filter123"
    assert r["trashed_existing"] == 5
    assert r["removed_rows"] == 2
    assert service.get_sources(db) == []  # rows gone


def test_unsubscribe_source_one_click(monkeypatch):
    db = _session()
    _add(db, "a1", "Promo <deals@store.com>", datetime(2026, 6, 1))
    monkeypatch.setattr(gc, "get_unsubscribe_info",
                        lambda mid: {"method": "one_click", "https_url": "https://x/u", "mailto": None})
    monkeypatch.setattr(gc, "one_click_unsubscribe", lambda url: True)
    r = service.unsubscribe_source(db, "deals@store.com")
    assert r["status"] == "done" and r["method"] == "one_click"


def test_unsubscribe_suppresses_and_clears(monkeypatch):
    db = _session()
    _add(db, "a1", "Promo <deals@store.com>", datetime(2026, 6, 1))
    _add(db, "a2", "Promo <deals@store.com>", datetime(2026, 6, 2))
    monkeypatch.setattr(gc, "get_unsubscribe_info",
                        lambda mid: {"method": "one_click", "https_url": "https://x/u", "mailto": None})
    monkeypatch.setattr(gc, "one_click_unsubscribe", lambda url: True)
    r = service.unsubscribe_source(db, "deals@store.com")
    assert r["removed_rows"] == 2
    assert service.get_sources(db) == []                       # gone from Sources
    assert "deals@store.com" in service._suppressed_set(db)    # remembered


def test_unsuppress_removes_filter(monkeypatch):
    db = _session()
    _add(db, "a1", "Promo <deals@store.com>", datetime(2026, 6, 1))
    monkeypatch.setattr(gc, "create_block_filter", lambda email: "filter-xyz")
    monkeypatch.setattr(gc, "trash_existing_from", lambda email, cap=100: 0)
    service.block_source(db, "deals@store.com")
    assert "deals@store.com" in service._suppressed_set(db)

    deleted = {}
    monkeypatch.setattr(gc, "delete_filter", lambda fid: deleted.update({"id": fid}) or True)
    r = service.unsuppress(db, "deals@store.com")
    assert r["filter_removed"] is True
    assert deleted["id"] == "filter-xyz"
    assert service.list_suppressed(db) == []


def test_generate_brief_heuristic(monkeypatch):
    db = _session()
    _add(db, "a1", "Promo <deals@store.com>", datetime(2026, 6, 1))
    _add(db, "a2", "News <news@other.com>", datetime(2026, 6, 2))
    monkeypatch.setattr(service, "get_provider", lambda override=None: type("P", (), {"name": "stub"})())
    b = service.generate_brief(db)
    assert b["stats"]["total"] == 2
    assert b["summary"]
    # second call without force returns the cached brief for the same day
    assert service.get_brief(db)["day"] == b["day"]


def test_suppressed_sender_skipped_in_sync(monkeypatch):
    db = _session()
    service._suppress(db, "spam@x.com", "unsubscribed"); db.commit()
    monkeypatch.setattr(gc, "list_inbox_ids", lambda limit=50: [{"id": "m1"}])
    monkeypatch.setattr(gc, "get_message_meta",
                        lambda mid: {"id": "m1", "sender": "Spam <spam@x.com>", "subject": "x",
                                     "snippet": "y", "received_at": None})
    monkeypatch.setattr(screening, "screen_email",
                        lambda meta, rules: {"category": "Other", "importance": 30, "summary": "s", "action": "fyi"})
    r = service.sync_to_db(db)
    assert r["screened_new"] == 0
    assert service.get_digest(db) == []
