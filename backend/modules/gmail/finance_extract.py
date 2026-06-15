"""Parse a financial email into structured statement/payment data.

Uses the configured LLM (Max-plan CLI in this setup). Heuristic fallback keeps
it working with no key. We only trust a 'statement' kind for balances so payment
confirmations never overwrite a real liability balance.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime

from backend.core.llm import get_provider

ACCOUNT_TYPES = ("credit_card", "loan", "other")
KINDS = ("statement", "payment", "other")

_SYSTEM = (
    "Extract credit-card / loan info from one billing email. Respond with ONLY a "
    "compact JSON object, no prose, ASCII only. Keys: "
    "kind (statement|payment|other), issuer (short name e.g. 'Chase'), "
    "last4 (4 digits or null), account_type (credit_card|loan|other), "
    "balance (number = statement balance owed, or null), "
    "minimum_payment (number or null), due_date (YYYY-MM-DD or null), apr (number or null). "
    "Use kind 'statement' only when it reports a current balance owed; 'payment' for "
    "payment received/scheduled confirmations; else 'other'. Unknown fields = null."
)

_AMOUNT = r"\$?\s*([0-9][0-9,]*\.?[0-9]{0,2})"


def _num(v) -> float | None:
    if v is None:
        return None
    try:
        return float(str(v).replace(",", "").replace("$", "").strip())
    except Exception:  # noqa: BLE001
        return None


def _parse_date(v) -> date | None:
    if not v:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(str(v).strip(), fmt).date()
        except Exception:  # noqa: BLE001
            continue
    return None


def _heuristic(meta: dict, body: str) -> dict:
    text = f"{meta.get('subject') or ''}\n{body}".lower()
    issuer = (meta.get("sender") or "").split("<")[0].strip() or None
    last4 = None
    m = re.search(r"(?:ending|x{2,}|\*{2,}|\.{2,})\s*(\d{4})", text)
    if m:
        last4 = m.group(1)
    if any(k in text for k in ("payment received", "payment scheduled", "thank you for your payment", "we've received")):
        kind = "payment"
    elif any(k in text for k in ("statement", "balance", "amount due", "minimum payment")):
        kind = "statement"
    else:
        kind = "other"
    balance = None
    if kind == "statement":
        mb = re.search(r"(?:statement balance|new balance|balance)[^$0-9]{0,20}" + _AMOUNT, text)
        balance = _num(mb.group(1)) if mb else None
    mm = re.search(r"minimum (?:payment )?(?:due )?[^$0-9]{0,20}" + _AMOUNT, text)
    return {
        "kind": kind, "issuer": issuer, "last4": last4, "account_type": "credit_card",
        "balance": balance, "minimum_payment": _num(mm.group(1)) if mm else None,
        "due_date": None, "apr": None,
    }


def _coerce(obj: dict, meta: dict) -> dict:
    kind = obj.get("kind") if obj.get("kind") in KINDS else "other"
    acct = obj.get("account_type") if obj.get("account_type") in ACCOUNT_TYPES else "credit_card"
    last4 = obj.get("last4")
    last4 = str(last4) if last4 and re.fullmatch(r"\d{4}", str(last4)) else None
    return {
        "kind": kind,
        "issuer": (obj.get("issuer") or (meta.get("sender") or "").split("<")[0].strip() or None),
        "last4": last4,
        "account_type": acct,
        "balance": _num(obj.get("balance")) if kind == "statement" else None,
        "minimum_payment": _num(obj.get("minimum_payment")),
        "due_date": _parse_date(obj.get("due_date")),
        "apr": _num(obj.get("apr")),
    }


SPEND_CATEGORIES = ("groceries", "dining", "shopping", "subscriptions", "travel",
                    "transport", "entertainment", "bills", "health", "other")

_PURCHASE_SYSTEM = (
    "Decide if this email is a purchase receipt / order confirmation and extract the spend. "
    "Respond with ONLY a compact JSON object, ASCII only. Keys: "
    "is_purchase (true/false), merchant (short name), amount (number = total charged/paid), "
    "category (one of " + ", ".join(SPEND_CATEGORIES) + "), "
    "is_subscription (true if a recurring subscription/membership/renewal), "
    "date (YYYY-MM-DD or null). "
    "Set is_purchase=false for promos, newsletters, shipping-only notices, statements, "
    "login/security alerts, or anything with no amount actually charged. "
    "IMPORTANT: set is_purchase=false for money MOVEMENT that is not consumption — "
    "investment/brokerage deposits or transfers (Robinhood, Coinbase, Fidelity funding), "
    "bank/account transfers, and peer-to-peer payments (Venmo, Zelle, Cash App, PayPal "
    "send/receive) unless the email clearly shows a purchase of goods or services from a merchant. "
    "Only count actual spending on goods/services."
)

# merchants/keywords that signal transfers, not consumption spending
_TRANSFER_HINTS = ("venmo", "zelle", "cash app", "cashapp", "robinhood", "coinbase",
                   "fidelity", "wire transfer", "ach transfer", "you sent", "sent you",
                   "transfer to", "transfer from", "deposit", "added to your balance")


def _heuristic_purchase(meta: dict, body: str) -> dict:
    text = f"{meta.get('subject') or ''}\n{body}".lower()
    merchant = (meta.get("sender") or "").split("<")[0].strip() or None
    is_purchase = any(k in text for k in ("order total", "total charged", "you paid", "receipt",
                                          "order confirmation", "amount paid", "payment to"))
    m = re.search(r"(?:order total|total|amount(?: paid| charged)?|you paid)[^$0-9]{0,15}" + _AMOUNT, text)
    amount = _num(m.group(1)) if m else None
    if amount is None:
        is_purchase = False
    sub = any(k in text for k in ("subscription", "membership", "renew", "auto-renew", "monthly plan"))
    if _looks_like_transfer(meta):
        is_purchase = False
    return {"is_purchase": bool(is_purchase and amount), "merchant": merchant, "amount": amount or 0.0,
            "category": "subscriptions" if sub else "other", "is_subscription": sub, "date": None}


def _looks_like_transfer(meta: dict) -> bool:
    blob = f"{meta.get('sender') or ''} {meta.get('subject') or ''}".lower()
    return any(h in blob for h in _TRANSFER_HINTS)


def _coerce_purchase(obj: dict, meta: dict) -> dict:
    cat = obj.get("category") if obj.get("category") in SPEND_CATEGORIES else "other"
    amount = _num(obj.get("amount"))
    # Safety net: even if the model says purchase, drop obvious transfers/deposits.
    transfer = _looks_like_transfer(meta)
    return {
        "is_purchase": bool(obj.get("is_purchase")) and amount is not None and amount > 0 and not transfer,
        "merchant": (obj.get("merchant") or (meta.get("sender") or "").split("<")[0].strip() or None),
        "amount": amount or 0.0,
        "category": cat,
        "is_subscription": bool(obj.get("is_subscription")),
        "date": _parse_date(obj.get("date")),
    }


def extract_purchase(meta: dict, body: str) -> dict:
    provider = get_provider()
    if getattr(provider, "name", "") == "stub":
        return _heuristic_purchase(meta, body)
    user = (f"From: {meta.get('sender')}\nSubject: {meta.get('subject')}\n\n{body}")[:6000]
    try:
        raw = provider.chat(_PURCHASE_SYSTEM, [{"role": "user", "content": user}])
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        obj = json.loads(m.group(0) if m else raw)
        return _coerce_purchase(obj, meta)
    except Exception:  # noqa: BLE001
        return _heuristic_purchase(meta, body)


_IMPORT_SYSTEM = (
    "You are given the flattened text of a bank/credit-card statement or transaction export. "
    "Extract spending. Respond with ONLY a compact JSON object, ASCII only, of the form "
    '{"balance": number|null, "transactions": [{"date":"YYYY-MM-DD","merchant":str,'
    '"amount":number,"category":one of ' + "/".join(SPEND_CATEGORIES) + ',"is_subscription":bool}]}. '
    "balance = the statement balance owed if the document states one, else null. "
    "Include only purchases of goods/services (amount > 0). EXCLUDE payments to the card, "
    "refunds/credits/returns, interest, and transfers (Venmo/Zelle/bank/brokerage). "
    "If there are many transactions, include them all."
)


def extract_transactions(text: str) -> dict:
    """Parse flattened statement text into {balance, transactions[]}."""
    provider = get_provider()
    if getattr(provider, "name", "") == "stub":
        return {"balance": None, "transactions": []}
    try:
        raw = provider.chat(_IMPORT_SYSTEM, [{"role": "user", "content": text}])
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        obj = json.loads(m.group(0) if m else raw)
    except Exception:  # noqa: BLE001
        return {"balance": None, "transactions": []}

    txns = []
    for t in (obj.get("transactions") or []):
        amt = _num(t.get("amount"))
        if amt is None or amt <= 0:
            continue
        cat = t.get("category") if t.get("category") in SPEND_CATEGORIES else "other"
        txns.append({
            "date": _parse_date(t.get("date")),
            "merchant": (str(t.get("merchant")).strip() if t.get("merchant") else None),
            "amount": amt,
            "category": cat,
            "is_subscription": bool(t.get("is_subscription")),
        })
    return {"balance": _num(obj.get("balance")), "transactions": txns}


def extract_statement(meta: dict, body: str) -> dict:
    provider = get_provider()
    if getattr(provider, "name", "") == "stub":
        return _heuristic(meta, body)
    user = (f"From: {meta.get('sender')}\nSubject: {meta.get('subject')}\n\n{body}")[:6000]
    try:
        raw = provider.chat(_SYSTEM, [{"role": "user", "content": user}])
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        obj = json.loads(m.group(0) if m else raw)
        return _coerce(obj, meta)
    except Exception:  # noqa: BLE001
        return _heuristic(meta, body)
