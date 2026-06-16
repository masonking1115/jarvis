"""Screening orchestration shared by the /sync endpoint and the scheduler.

sync_to_db: list recent INBOX messages, screen only the ones we haven't seen
(idempotent on Gmail message_id), store the triage result. Bounded per run by
settings.gmail_backfill so cost stays predictable.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timedelta

from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.llm import get_provider
from backend.modules.finance.models import Liability
from . import client as gc
from . import screening
from . import finance_extract
from . import file_import
from .models import (EmailScreening, PriorityRule, SuppressedSender, EmailBrief,
                     CardStatement, Purchase)


def _rules_as_dicts(db: Session) -> list[dict]:
    rows = db.execute(select(PriorityRule)).scalars().all()
    return [{"kind": r.kind, "value": r.value, "weight": r.weight} for r in rows]


def _suppressed_set(db: Session) -> set[str]:
    return set(db.execute(select(SuppressedSender.email)).scalars().all())


def _suppress(db: Session, email: str, reason: str, filter_id: str | None = None) -> None:
    email = email.lower().strip()
    if not email:
        return
    exists = db.execute(
        select(SuppressedSender).where(SuppressedSender.email == email)
    ).scalars().first()
    if exists:
        exists.reason = reason
        if filter_id:
            exists.filter_id = filter_id
    else:
        db.add(SuppressedSender(email=email, reason=reason, filter_id=filter_id))


def list_suppressed(db: Session) -> list[dict]:
    rows = db.execute(
        select(SuppressedSender).order_by(SuppressedSender.created_at.desc())
    ).scalars().all()
    return [{"email": r.email, "reason": r.reason, "has_filter": bool(r.filter_id),
             "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]


def unsuppress(db: Session, email: str) -> dict:
    """Undo an unsubscribe/block: drop the suppression and, for blocks, delete
    the Gmail filter so their mail returns to the inbox. (Trashed mail is left in
    Trash — recoverable in Gmail for 30 days.)"""
    email = email.lower().strip()
    row = db.execute(
        select(SuppressedSender).where(SuppressedSender.email == email)
    ).scalars().first()
    if not row:
        return {"restored": email, "filter_removed": False}
    filter_removed = False
    if row.filter_id:
        try:
            filter_removed = gc.delete_filter(row.filter_id)
        except Exception:  # noqa: BLE001 — still drop the suppression locally
            filter_removed = False
    db.execute(delete(SuppressedSender).where(SuppressedSender.email == email))
    db.commit()
    return {"restored": email, "filter_removed": filter_removed}


def sync_to_db(db: Session) -> dict:
    """Screen new inbox messages. Returns counts. Raises GmailNotConnected if
    not signed in (callers downgrade to {available: false})."""
    cap = max(1, settings.gmail_backfill)
    refs = gc.list_inbox_ids(limit=max(cap, 50))
    ids = [r.get("id") for r in refs if r.get("id")]
    if not ids:
        return {"screened_new": 0, "skipped_existing": 0, "inbox_seen": 0}

    existing = set(
        db.execute(
            select(EmailScreening.message_id).where(EmailScreening.message_id.in_(ids))
        ).scalars().all()
    )
    new_ids = [i for i in ids if i not in existing][:cap]

    rules = _rules_as_dicts(db)
    suppressed = _suppressed_set(db)
    screened = 0
    for mid in new_ids:
        try:
            meta = gc.get_message_meta(mid)
        except gc.GmailNotConnected:
            raise
        except Exception:  # noqa: BLE001 — skip a single unreadable message
            continue
        if gc.parse_email_addr(meta.get("sender")) in suppressed:
            continue  # unsubscribed/blocked — don't surface it again
        result = screening.screen_email(meta, rules)
        db.add(EmailScreening(
            message_id=meta["id"],
            thread_id=meta.get("thread_id"),
            sender=meta.get("sender"),
            subject=meta.get("subject"),
            snippet=meta.get("snippet"),
            received_at=meta.get("received_at"),
            category=result["category"],
            importance=result["importance"],
            summary=result["summary"],
            action=result["action"],
        ))
        screened += 1
    db.commit()
    return {"screened_new": screened, "skipped_existing": len(existing), "inbox_seen": len(ids)}


def get_digest(db: Session, limit: int = 100) -> list[dict]:
    rows = db.execute(
        select(EmailScreening).order_by(EmailScreening.received_at.desc().nullslast()).limit(limit)
    ).scalars().all()
    return [{
        "id": r.id,
        "message_id": r.message_id,
        "thread_id": r.thread_id,
        "sender": r.sender,
        "subject": r.subject,
        "snippet": r.snippet,
        "received_at": r.received_at.isoformat() if r.received_at else None,
        "category": r.category,
        "importance": r.importance,
        "summary": r.summary,
        "action": r.action,
    } for r in rows]


# ---- financial extraction (credit cards / debts) ----
_LIAB_CATEGORY = {"credit_card": "credit_card", "loan": "other", "other": "other"}


def _upsert_liability_from_statement(db: Session, st: dict, received: datetime | None) -> bool:
    """Create/update a Liability from a parsed statement. Only statements with a
    real balance touch liabilities. Keyed on source='email' + issuer:last4."""
    if st.get("kind") != "statement" or st.get("balance") is None or not st.get("issuer"):
        return False
    issuer = st["issuer"].strip()
    last4 = st.get("last4")
    ext = f"{issuer}:{last4 or ''}".lower()
    name = f"{issuer}" + (f" ••{last4}" if last4 else "")
    row = db.execute(
        select(Liability).where(Liability.source == "email", Liability.external_id == ext)
    ).scalars().first()
    if not row:
        row = Liability(name=name, source="email", external_id=ext,
                        category=_LIAB_CATEGORY.get(st.get("account_type"), "other"))
        db.add(row)
    row.balance = float(st["balance"])
    if st.get("minimum_payment") is not None:
        row.minimum_payment = float(st["minimum_payment"])
    if st.get("apr") is not None:
        row.apr = float(st["apr"])
    if st.get("due_date") is not None:
        row.due_day_of_month = st["due_date"].day
    row.name = name
    row.last_updated = datetime.utcnow()
    return True


# Gmail search for statement-style emails across the whole mailbox (not just the
# recently-screened window), so monthly statements with real balances get found.
_STATEMENT_QUERY = (
    'newer_than:180d ('
    'subject:statement OR subject:"minimum payment" OR subject:"amount due" '
    'OR subject:"statement is ready" OR subject:"your bill" '
    'OR "statement balance" OR "minimum payment due")'
)


def _finance_candidate_ids(db: Session) -> list[str]:
    """Message ids to consider: recently-screened 'Financial' mail + a mailbox
    search for statement emails. Deduped, search results appended after screened."""
    ids: list[str] = []
    ids += list(db.execute(
        select(EmailScreening.message_id).where(EmailScreening.category == "Financial")
    ).scalars().all())
    try:
        ids += gc.search_message_ids(_STATEMENT_QUERY, limit=40)
    except gc.GmailNotConnected:
        raise
    except Exception:  # noqa: BLE001
        pass
    seen, ordered = set(), []
    for mid in ids:
        if mid and mid not in seen:
            seen.add(mid); ordered.append(mid)
    return ordered


def extract_finances_to_db(db: Session, cap: int = 20) -> dict:
    """Parse financial emails into CardStatement rows + upsert Liabilities.
    Pulls candidates from screened mail AND a mailbox search for statements."""
    done = set(db.execute(select(CardStatement.message_id)).scalars().all())
    todo = [mid for mid in _finance_candidate_ids(db) if mid not in done][:cap]

    extracted, liabilities = 0, 0
    for mid in todo:
        try:
            meta = gc.get_message_meta(mid)
            body = gc.get_message_body(mid)
        except gc.GmailNotConnected:
            raise
        except Exception:  # noqa: BLE001
            continue
        # LLM extraction happens with NO write transaction held (avoids lock contention).
        st = finance_extract.extract_statement(
            {"sender": meta.get("sender"), "subject": meta.get("subject")}, body)
        db.add(CardStatement(
            message_id=mid, issuer=st.get("issuer"), last4=st.get("last4"),
            account_type=st.get("account_type", "credit_card"), kind=st.get("kind", "other"),
            balance=st.get("balance"), minimum_payment=st.get("minimum_payment"),
            due_date=st.get("due_date"), apr=st.get("apr"),
            subject=meta.get("subject"), received_at=meta.get("received_at"),
        ))
        upserted = _upsert_liability_from_statement(db, st, meta.get("received_at"))
        try:
            db.commit()  # short write — released between rows
        except IntegrityError:
            db.rollback(); continue  # already parsed by a concurrent run
        except Exception:  # noqa: BLE001
            db.rollback(); continue
        extracted += 1
        if upserted:
            liabilities += 1
    return {"extracted": extracted, "liabilities_updated": liabilities}


def get_statement_reminders(db: Session) -> list[dict]:
    """Per card: latest statement email + whether the linked liability needs a
    manual balance update (statement arrived after the liability was last edited,
    and the issuer doesn't email the balance). Drives the Finance reminders panel."""
    stmts = db.execute(
        select(CardStatement).where(CardStatement.kind == "statement")
        .order_by(CardStatement.received_at.desc().nullslast())
    ).scalars().all()
    latest: dict[str, CardStatement] = {}
    for s in stmts:
        key = (s.issuer or "").strip().lower()
        if key and key not in latest:
            latest[key] = s

    liabs = db.execute(select(Liability)).scalars().all()
    out = []
    for s in latest.values():
        issuer_l = (s.issuer or "").lower()
        match = next((l for l in liabs
                      if issuer_l and (issuer_l in (l.name or "").lower()
                                       or (l.name or "").lower() in issuer_l)), None)
        if match is None:
            continue  # only remind on issuers tracked as a liability (real cards), skip noise
        emails_balance = s.balance is not None
        needs_update = False
        if not emails_balance and match is not None:
            # manual card: flag if the statement is newer than the last manual edit
            if s.received_at and (match.last_updated is None or s.received_at > match.last_updated):
                needs_update = True
        out.append({
            "issuer": s.issuer, "last4": s.last4,
            "due_date": s.due_date.isoformat() if s.due_date else None,
            "statement_received_at": s.received_at.isoformat() if s.received_at else None,
            "balance_in_email": s.balance,
            "emails_balance": emails_balance,
            "message_id": s.message_id,
            "liability_id": match.id if match else None,
            "liability_name": match.name if match else None,
            "current_balance": match.balance if match else None,
            "needs_update": needs_update,
        })
    out.sort(key=lambda x: (not x["needs_update"], x["issuer"] or ""))
    return out


def get_email_statements(db: Session, limit: int = 50) -> list[dict]:
    rows = db.execute(
        select(CardStatement).order_by(CardStatement.received_at.desc().nullslast()).limit(limit)
    ).scalars().all()
    return [{
        "id": r.id, "message_id": r.message_id, "issuer": r.issuer, "last4": r.last4,
        "account_type": r.account_type, "kind": r.kind, "balance": r.balance,
        "minimum_payment": r.minimum_payment,
        "due_date": r.due_date.isoformat() if r.due_date else None,
        "apr": r.apr, "subject": r.subject,
        "received_at": r.received_at.isoformat() if r.received_at else None,
    } for r in rows]


# ---- spending (purchases from receipts) ----
_PURCHASE_QUERY = (
    'newer_than:120d ('
    'subject:receipt OR subject:order OR subject:"order confirmation" OR subject:"your order" '
    'OR subject:invoice OR subject:"your receipt" OR subject:"payment to" '
    'OR "order total" OR "total charged" OR "you paid" OR "amount paid")'
)


def extract_purchases_to_db(db: Session, cap: int = 25) -> dict:
    """Search receipts/order emails, parse spend, store Purchase rows."""
    done = set(db.execute(select(Purchase.message_id)).scalars().all())
    try:
        ids = gc.search_message_ids(_PURCHASE_QUERY, limit=50)
    except gc.GmailNotConnected:
        raise
    except Exception:  # noqa: BLE001
        ids = []
    todo = [m for m in ids if m and m not in done][:cap]

    added = 0
    for mid in todo:
        try:
            meta = gc.get_message_meta(mid)
            body = gc.get_message_body(mid)
        except gc.GmailNotConnected:
            raise
        except Exception:  # noqa: BLE001
            continue
        p = finance_extract.extract_purchase(
            {"sender": meta.get("sender"), "subject": meta.get("subject")}, body)
        if not p.get("is_purchase"):
            continue
        db.add(Purchase(
            message_id=mid, merchant=p.get("merchant"), amount=float(p.get("amount") or 0),
            category=p.get("category", "other"), is_subscription=bool(p.get("is_subscription")),
            occurred_at=(datetime(p["date"].year, p["date"].month, p["date"].day)
                         if p.get("date") else meta.get("received_at")),
            subject=meta.get("subject"),
        ))
        try:
            db.commit()  # short write — released between rows
        except IntegrityError:
            db.rollback(); continue
        except Exception:  # noqa: BLE001
            db.rollback(); continue
        added += 1
    return {"scanned": len(todo), "purchases_added": added}


def import_transactions_to_db(db: Session, filename: str | None, blob: bytes,
                              liability_id: int | None = None) -> dict:
    """Parse an uploaded CSV/XLSX/PDF statement -> Purchases (deduped) + optional
    balance update on the chosen card. Raises file_import.UnsupportedFile on bad files."""
    # Bilt only offers a payment-history report, so for Bilt we count listed
    # payments as expenses (every other card excludes payments).
    liab_name = ""
    if liability_id:
        _l = db.get(Liability, liability_id)
        liab_name = (_l.name or "").lower() if _l else ""
    include_payments = "bilt" in liab_name

    text = file_import.parse_file(filename, blob)
    data = finance_extract.extract_transactions(text, include_payments=include_payments)
    logging.getLogger("gmail.import").warning(
        "import %r (include_payments=%s): %d chars, %d txns parsed, balance=%s",
        filename, include_payments, len(text), len(data["transactions"]), data.get("balance"))

    added = 0
    for t in data["transactions"]:
        d = t.get("date")
        merchant = t.get("merchant") or "Unknown"
        amt = t["amount"]
        # stable synthetic id so re-importing the same file doesn't duplicate rows
        key = "imp:" + hashlib.md5(
            f"{liability_id}|{d.isoformat() if d else '?'}|{amt}|{merchant}".encode()).hexdigest()[:20]
        if db.execute(select(Purchase.id).where(Purchase.message_id == key)).first():
            continue
        db.add(Purchase(
            message_id=key, liability_id=liability_id, merchant=merchant, amount=float(amt),
            category=t["category"], is_subscription=bool(t["is_subscription"]),
            occurred_at=(datetime(d.year, d.month, d.day) if d else None),
            subject=f"import: {filename}" if filename else "import",
        ))
        try:
            db.commit(); added += 1
        except IntegrityError:
            db.rollback()

    balance_updated = False
    bal = data.get("balance")
    if liability_id and bal is not None:
        liab = db.get(Liability, liability_id)
        if liab:
            liab.balance = float(bal)
            liab.last_updated = datetime.utcnow()
            db.commit()
            balance_updated = True

    return {"parsed": len(data["transactions"]), "transactions_added": added,
            "balance": bal, "balance_updated": balance_updated}


def get_card_spending(db: Session, per_card: int = 300) -> list[dict]:
    """Each credit-card liability with its balance/due and imported transactions
    (newest first). Powers the per-card grid on the Finance tab."""
    liabs = db.execute(
        select(Liability).where(Liability.category == "credit_card").order_by(Liability.name)
    ).scalars().all()
    out = []
    for l in liabs:
        txns = db.execute(
            select(Purchase).where(Purchase.liability_id == l.id)
            .order_by(Purchase.occurred_at.desc().nullslast()).limit(per_card)
        ).scalars().all()
        out.append({
            "liability_id": l.id, "name": l.name, "balance": l.balance,
            "source": l.source, "due_day_of_month": l.due_day_of_month,
            "transactions": [{
                "date": t.occurred_at.isoformat() if t.occurred_at else None,
                "merchant": t.merchant, "amount": t.amount, "category": t.category,
            } for t in txns],
        })
    return out


def delete_statement(db: Session, liability_id: int, month: str) -> dict:
    """Delete the imported transactions for one card+month ('YYYY-MM' or 'undated').
    Leaves the card's balance untouched."""
    rows = db.execute(select(Purchase).where(Purchase.liability_id == liability_id)).scalars().all()
    ids = [r.id for r in rows
           if (r.occurred_at.strftime("%Y-%m") if r.occurred_at else "undated") == month]
    if ids:
        db.execute(delete(Purchase).where(Purchase.id.in_(ids)))
        db.commit()
    return {"deleted": len(ids)}


def get_spending_summary(db: Session, days: int = 90) -> dict:
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = db.execute(select(Purchase)).scalars().all()
    rows = [r for r in rows if (r.occurred_at or r.detected_at) >= cutoff]

    total = sum(r.amount for r in rows)
    by_cat: dict[str, dict] = {}
    by_merch: dict[str, dict] = {}
    by_month: dict[str, float] = {}
    subs: dict[str, float] = {}
    for r in rows:
        eff = r.occurred_at or r.detected_at
        c = by_cat.setdefault(r.category, {"category": r.category, "amount": 0.0, "count": 0})
        c["amount"] += r.amount; c["count"] += 1
        mname = (r.merchant or "Unknown").strip()
        m = by_merch.setdefault(mname, {"merchant": mname, "amount": 0.0, "count": 0})
        m["amount"] += r.amount; m["count"] += 1
        mk = eff.strftime("%Y-%m")
        by_month[mk] = by_month.get(mk, 0.0) + r.amount
        if r.is_subscription:
            subs[mname] = max(subs.get(mname, 0.0), r.amount)  # latest/highest seen per merchant

    this_month = datetime.utcnow().strftime("%Y-%m")
    return {
        "days": days,
        "total": round(total, 2),
        "this_month": round(by_month.get(this_month, 0.0), 2),
        "subscriptions_monthly": round(sum(subs.values()), 2),
        "count": len(rows),
        "by_category": sorted(({"category": v["category"], "amount": round(v["amount"], 2), "count": v["count"]}
                               for v in by_cat.values()), key=lambda x: -x["amount"]),
        "top_merchants": sorted(({"merchant": v["merchant"], "amount": round(v["amount"], 2), "count": v["count"]}
                                 for v in by_merch.values()), key=lambda x: -x["amount"])[:10],
        "monthly": [{"month": k, "amount": round(by_month[k], 2)} for k in sorted(by_month)],
        "subscriptions": sorted(({"merchant": k, "amount": round(v, 2)} for k, v in subs.items()),
                                key=lambda x: -x["amount"]),
        "recent": [{
            "merchant": r.merchant, "amount": r.amount, "category": r.category,
            "is_subscription": r.is_subscription,
            "occurred_at": (r.occurred_at or r.detected_at).isoformat(),
            "message_id": r.message_id, "subject": r.subject,
        } for r in sorted(rows, key=lambda x: (x.occurred_at or x.detected_at), reverse=True)[:20]],
    }


# ---- daily brief ----
_BRIEF_SYSTEM = (
    "You write a short, friendly daily inbox brief for the user. 3-6 concise lines "
    "(plain sentences or '-' bullets, no markdown headers). Lead with anything that "
    "needs a reply or action, then money/bills, then notable items, then a one-line "
    "note on promo/newsletter volume. Be specific but brief. No preamble. "
    "Use only plain ASCII punctuation (hyphens, not em-dashes) and no emoji."
)


def _brief_stats(rows: list[EmailScreening]) -> dict:
    by_cat: dict[str, int] = {}
    for r in rows:
        by_cat[r.category] = by_cat.get(r.category, 0) + 1
    needs = sum(1 for r in rows if r.action == "needs_reply" or r.category == "Needs reply")
    return {"total": len(rows), "by_category": by_cat,
            "needs_reply": needs, "financial": by_cat.get("Financial", 0)}


def _heuristic_brief(rows: list[EmailScreening], stats: dict) -> str:
    lines = [f"{stats['total']} emails in the last 24h."]
    nr = [r for r in rows if r.action == "needs_reply" or r.category == "Needs reply"]
    if nr:
        lines.append(f"{len(nr)} may need a reply: " + "; ".join(
            f"{(r.subject or '(no subject)')[:50]}" for r in nr[:3]))
    fin = [r for r in rows if r.category == "Financial"]
    if fin:
        lines.append(f"{len(fin)} financial: " + "; ".join((r.subject or "")[:50] for r in fin[:3]))
    promo = stats["by_category"].get("Newsletter", 0) + stats["by_category"].get("Other", 0)
    if promo:
        lines.append(f"{promo} promotional/other (low priority).")
    return "\n".join(lines)


def generate_brief(db: Session, force: bool = False) -> dict:
    day = datetime.utcnow().strftime("%Y-%m-%d")
    existing = db.execute(select(EmailBrief).where(EmailBrief.day == day)).scalars().first()
    if existing and not force:
        return _brief_dict(existing)

    cutoff = datetime.utcnow() - timedelta(hours=24)
    rows = db.execute(
        select(EmailScreening)
        .where(EmailScreening.received_at >= cutoff)
        .order_by(EmailScreening.importance.desc())
    ).scalars().all()
    if not rows:  # fall back to most recent 40 if nothing is timestamped in-window
        rows = db.execute(
            select(EmailScreening).order_by(EmailScreening.screened_at.desc()).limit(40)
        ).scalars().all()

    stats = _brief_stats(rows)
    provider = get_provider()
    if getattr(provider, "name", "") == "stub" or not rows:
        summary = _heuristic_brief(rows, stats) if rows else "No recent email to summarize."
    else:
        lines = [
            f"[{r.category}|imp{r.importance}|{r.action}] {service_sender(r.sender)}: {(r.subject or '')[:80]}"
            for r in rows[:40]
        ]
        user = "Screened email (last 24h):\n" + "\n".join(lines)
        try:
            summary = provider.chat(_BRIEF_SYSTEM, [{"role": "user", "content": user}]) or _heuristic_brief(rows, stats)
        except Exception:  # noqa: BLE001
            summary = _heuristic_brief(rows, stats)

    if existing:
        existing.summary = summary
        existing.stats = json.dumps(stats)
        existing.created_at = datetime.utcnow()
        row = existing
    else:
        row = EmailBrief(day=day, summary=summary, stats=json.dumps(stats))
        db.add(row)
    db.commit(); db.refresh(row)
    return _brief_dict(row)


def get_brief(db: Session) -> dict:
    """Return today's brief, generating it if it doesn't exist yet."""
    return generate_brief(db, force=False)


def ensure_daily_brief(db: Session) -> None:
    """Called by the scheduler: generate today's brief once if missing."""
    day = datetime.utcnow().strftime("%Y-%m-%d")
    if not db.execute(select(EmailBrief.id).where(EmailBrief.day == day)).first():
        generate_brief(db, force=False)


def service_sender(sender: str | None) -> str:
    return _display_name(sender) or "?"


def _brief_dict(row: EmailBrief) -> dict:
    try:
        stats = json.loads(row.stats) if row.stats else {}
    except Exception:  # noqa: BLE001
        stats = {}
    return {"day": row.day, "summary": row.summary, "stats": stats,
            "created_at": row.created_at.isoformat() if row.created_at else None}


# ---- sources (grouped by sender) ----
def get_sources(db: Session) -> list[dict]:
    """Collapse screened mail by sender email so the UI can offer per-source
    unsubscribe/block. Sorted by message count desc."""
    rows = db.execute(select(EmailScreening)).scalars().all()
    suppressed = _suppressed_set(db)
    groups: dict[str, dict] = {}
    for r in rows:
        email = gc.parse_email_addr(r.sender)
        if not email or email in suppressed:
            continue
        g = groups.get(email)
        if not g:
            g = {"email": email, "name": _display_name(r.sender), "count": 0,
                 "category": r.category, "importance": r.importance,
                 "latest_message_id": r.message_id, "latest_at": r.received_at}
            groups[email] = g
        g["count"] += 1
        if r.received_at and (g["latest_at"] is None or r.received_at > g["latest_at"]):
            g["latest_at"] = r.received_at
            g["latest_message_id"] = r.message_id
            g["category"] = r.category
        g["importance"] = max(g["importance"], r.importance)
    out = []
    for g in groups.values():
        out.append({
            "email": g["email"], "name": g["name"], "count": g["count"],
            "category": g["category"], "importance": g["importance"],
            "latest_message_id": g["latest_message_id"],
            "latest_at": g["latest_at"].isoformat() if g["latest_at"] else None,
        })
    out.sort(key=lambda x: (-x["count"], -x["importance"]))
    return out


def _display_name(sender: str | None) -> str:
    if not sender:
        return ""
    m = re.match(r'\s*"?([^"<]+?)"?\s*<', sender)
    return (m.group(1).strip() if m else gc.parse_email_addr(sender))


def unsubscribe_source(db, sender_email: str) -> dict:
    """Find the latest message from this sender and act on its List-Unsubscribe."""
    row = db.execute(
        select(EmailScreening).where(EmailScreening.sender.ilike(f"%{sender_email}%"))
        .order_by(EmailScreening.received_at.desc().nullslast())
    ).scalars().first()
    if not row:
        return {"status": "unavailable", "reason": "no message found for sender"}
    info = gc.get_unsubscribe_info(row.message_id)
    method = info.get("method")

    def _clear() -> int:
        """Suppress the sender and drop their rows so they leave Sources/digest
        and won't be re-screened. Does NOT touch the actual Gmail mail."""
        _suppress(db, sender_email, "unsubscribed")
        n = db.execute(
            delete(EmailScreening).where(EmailScreening.sender.ilike(f"%{sender_email}%"))
        ).rowcount
        db.commit()
        return n

    try:
        if method == "one_click":
            ok = gc.one_click_unsubscribe(info["https_url"])
            if not ok:
                return {"status": "failed", "method": "one_click"}
            return {"status": "done", "method": "one_click", "removed_rows": _clear()}
        if method == "mailto":
            gc.send_unsubscribe_email(info["mailto"])
            return {"status": "sent", "method": "mailto", "removed_rows": _clear()}
        if method == "link":
            return {"status": "manual", "method": "link", "url": info["https_url"],
                    "removed_rows": _clear()}
        return {"status": "unavailable", "method": "none",
                "reason": "sender provides no unsubscribe header — use Block instead"}
    except gc.GmailNotConnected:
        raise
    except Exception as e:  # noqa: BLE001
        return {"status": "failed", "reason": str(e)}


def block_source(db, sender_email: str) -> dict:
    """Filter future mail from sender to trash, clear existing, drop our rows."""
    filter_id = gc.create_block_filter(sender_email)
    trashed = gc.trash_existing_from(sender_email)
    _suppress(db, sender_email, "blocked", filter_id=filter_id)
    removed = db.execute(
        delete(EmailScreening).where(EmailScreening.sender.ilike(f"%{sender_email}%"))
    ).rowcount
    db.commit()
    return {"blocked": sender_email, "filter_id": filter_id,
            "trashed_existing": trashed, "removed_rows": removed}


# ---- priority rules CRUD ----
def list_rules(db: Session) -> list[dict]:
    rows = db.execute(select(PriorityRule).order_by(PriorityRule.created_at.desc())).scalars().all()
    return [{"id": r.id, "kind": r.kind, "value": r.value, "weight": r.weight} for r in rows]


def add_rule(db: Session, kind: str, value: str, weight: int = 25) -> dict:
    kind = "sender" if kind == "sender" else "keyword"
    row = PriorityRule(kind=kind, value=value.strip(), weight=max(0, min(100, int(weight))))
    db.add(row); db.commit(); db.refresh(row)
    return {"id": row.id, "kind": row.kind, "value": row.value, "weight": row.weight}


def delete_rule(db: Session, rule_id: int) -> dict:
    db.execute(delete(PriorityRule).where(PriorityRule.id == rule_id))
    db.commit()
    return {"deleted": rule_id}
