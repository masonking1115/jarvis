"""Triage one email into {category, importance, summary, action}.

Uses the configured LLM (backend.core.llm). If no API key is set the provider is
a StubProvider — we detect that and fall back to a deterministic heuristic so the
engine still works (and tests run) with no network/key. Either way, user
PriorityRules are applied deterministically afterward so they always take effect.
"""
from __future__ import annotations

import json
import re

from backend.core.llm import get_provider

CATEGORIES = ["Needs reply", "Important", "Financial", "Newsletter", "Other"]
ACTIONS = ["needs_reply", "fyi", "receipt", "archive", "none"]

_SYSTEM = (
    "You triage a single email. Respond with ONLY a compact JSON object, no prose. "
    "Keys: category (one of " + ", ".join(CATEGORIES) + "), "
    "importance (integer 0-100), summary (<=12 words), "
    "action (one of " + ", ".join(ACTIONS) + "). "
    "Promotional/automated mail is low importance; personal mail asking something is 'Needs reply'."
)

_FIN_HINTS = ("receipt", "invoice", "order", "payment", "purchase", "refund", "statement", "charged", "billed")
_PROMO_HINTS = ("unsubscribe", "newsletter", "no-reply", "noreply", "promotion", "% off", "sale", "deal")


def _clamp(n: int) -> int:
    return max(0, min(100, int(n)))


def _heuristic(meta: dict) -> dict:
    text = f"{meta.get('subject') or ''} {meta.get('snippet') or ''}".lower()
    sender = (meta.get("sender") or "").lower()
    if any(h in text or h in sender for h in _PROMO_HINTS):
        cat, imp, act = "Newsletter", 15, "archive"
    elif any(h in text for h in _FIN_HINTS):
        cat, imp, act = "Financial", 45, "receipt"
    elif "?" in (meta.get("subject") or "") and "no-reply" not in sender:
        cat, imp, act = "Needs reply", 60, "needs_reply"
    else:
        cat, imp, act = "Other", 30, "fyi"
    summary = (meta.get("subject") or meta.get("snippet") or "").strip()[:120] or "(no subject)"
    return {"category": cat, "importance": imp, "summary": summary, "action": act}


def _parse_llm(raw: str, meta: dict) -> dict:
    try:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        obj = json.loads(m.group(0) if m else raw)
    except Exception:  # noqa: BLE001
        return _heuristic(meta)
    cat = obj.get("category")
    if cat not in CATEGORIES:
        cat = _heuristic(meta)["category"]
    act = obj.get("action")
    if act not in ACTIONS:
        act = "fyi"
    return {
        "category": cat,
        "importance": _clamp(obj.get("importance", 30)),
        "summary": (str(obj.get("summary") or "").strip() or (meta.get("subject") or ""))[:200],
        "action": act,
    }


def _apply_rules(result: dict, meta: dict, rules: list[dict]) -> dict:
    sender = (meta.get("sender") or "").lower()
    text = f"{meta.get('subject') or ''} {meta.get('snippet') or ''}".lower()
    bump = 0
    for r in rules or []:
        val = (r.get("value") or "").lower().strip()
        if not val:
            continue
        if r.get("kind") == "sender" and val in sender:
            bump = max(bump, int(r.get("weight", 25)))
        elif r.get("kind") == "keyword" and val in text:
            bump = max(bump, int(r.get("weight", 25)))
    if bump:
        result = {**result, "importance": _clamp(result["importance"] + bump)}
    return result


def screen_email(meta: dict, rules: list[dict] | None = None) -> dict:
    """meta: {sender, subject, snippet, ...}. Returns the triage dict."""
    provider = get_provider()
    if getattr(provider, "name", "") == "stub":
        result = _heuristic(meta)
    else:
        hint = ""
        if rules:
            hint = "\nUser priority hints (raise importance if matched): " + ", ".join(
                f"{r.get('kind')}:{r.get('value')}" for r in rules
            )
        user = (
            f"From: {meta.get('sender')}\nSubject: {meta.get('subject')}\n"
            f"Preview: {meta.get('snippet')}{hint}"
        )
        try:
            raw = provider.chat(_SYSTEM, [{"role": "user", "content": user}])
            result = _parse_llm(raw, meta)
        except Exception:  # noqa: BLE001 — never let one screening crash the run
            result = _heuristic(meta)
    return _apply_rules(result, meta, rules or [])
