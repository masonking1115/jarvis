"""Gmail data client (read-only for now) over the stored OAuth token.

This is intentionally minimal: just enough to prove the link works
(status / connect / disconnect). The screening, digest, extraction and
draft-and-send surfaces will layer on top of `_bearer_get` later.

Bearer GETs hit https://gmail.googleapis.com/gmail/v1. The user is implied by
the token, addressed as `me`.
"""
from __future__ import annotations

import base64
import re
from datetime import datetime
from email.mime.text import MIMEText
from typing import Any
from urllib.parse import unquote, urlparse, parse_qs

import httpx

from backend.core.config import settings
from . import oauth

API_BASE = "https://gmail.googleapis.com/gmail/v1"


class GmailNotConfigured(Exception):
    """No Google OAuth client configured."""


class GmailNotConnected(Exception):
    """Not signed in to Gmail."""


def _token() -> str:
    try:
        return oauth.get_access_token()
    except oauth.OAuthError as e:
        raise GmailNotConnected(str(e)) from e


def _bearer_get(path: str) -> Any:
    r = httpx.get(
        f"{API_BASE}{path}",
        headers={"Authorization": f"Bearer {_token()}", "Accept": "application/json"},
        timeout=30,
    )
    if r.status_code == 401:
        raise GmailNotConnected("Gmail token rejected (401) — reconnect.")
    r.raise_for_status()
    return r.json()


def _bearer_post(path: str, json_body: dict | None = None) -> Any:
    r = httpx.post(
        f"{API_BASE}{path}",
        headers={"Authorization": f"Bearer {_token()}", "Accept": "application/json"},
        json=json_body or {},
        timeout=30,
    )
    if r.status_code == 401:
        raise GmailNotConnected("Gmail token rejected (401) — reconnect.")
    r.raise_for_status()
    return r.json() if r.content else {}


def parse_email_addr(sender: str | None) -> str:
    """'Robinhood <noreply@robinhood.com>' -> 'noreply@robinhood.com'."""
    if not sender:
        return ""
    m = re.search(r"<([^>]+)>", sender)
    cand = (m.group(1) if m else sender).strip().lower()
    return cand if "@" in cand else ""


def _get_profile() -> dict:
    return _bearer_get("/users/me/profile") or {}


# ---- public API ----
def status() -> dict:
    if not (settings.google_client_id and settings.google_client_secret):
        return {"configured": False, "connected": False,
                "reason": "Google OAuth client id/secret not set"}
    if not oauth.has_tokens():
        return {"configured": True, "connected": False,
                "reason": "Not signed in to Gmail yet"}
    try:
        profile = _get_profile()
        return {
            "configured": True,
            "connected": True,
            "email": profile.get("emailAddress"),
            "messages_total": profile.get("messagesTotal"),
            "threads_total": profile.get("threadsTotal"),
        }
    except GmailNotConnected as e:
        return {"configured": True, "connected": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"configured": True, "connected": False, "reason": f"gmail error: {e}"}


def list_inbox_ids(limit: int = 50) -> list[dict]:
    """Return the most recent INBOX message refs: [{id, threadId}, ...]."""
    data = _bearer_get(f"/users/me/messages?labelIds=INBOX&maxResults={int(limit)}")
    return list((data or {}).get("messages") or [])


def search_message_ids(query: str, limit: int = 40) -> list[str]:
    """Search the whole mailbox (Gmail query syntax), returning message ids."""
    from urllib.parse import quote
    data = _bearer_get(f"/users/me/messages?q={quote(query)}&maxResults={int(limit)}") or {}
    return [m.get("id") for m in (data.get("messages") or []) if m.get("id")]


def get_message_meta(message_id: str) -> dict:
    """Fetch headers + snippet for one message (metadata only — no body)."""
    msg = _bearer_get(
        f"/users/me/messages/{message_id}"
        "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date"
    ) or {}
    headers = {
        h.get("name", "").lower(): h.get("value")
        for h in (msg.get("payload", {}) or {}).get("headers", []) or []
    }
    received = None
    raw = msg.get("internalDate")
    if raw:
        try:
            received = datetime.utcfromtimestamp(int(raw) / 1000.0)
        except Exception:  # noqa: BLE001
            received = None
    return {
        "id": msg.get("id", message_id),
        "thread_id": msg.get("threadId"),
        "sender": headers.get("from"),
        "subject": headers.get("subject"),
        "snippet": msg.get("snippet"),
        "received_at": received,
    }


def connect() -> dict:
    """Begin the one-time browser OAuth sign-in; return the authorize URL to open."""
    if not (settings.google_client_id and settings.google_client_secret):
        raise GmailNotConfigured("Google OAuth client id/secret not set")
    return {"redirect_url": oauth.start_authorization()}


def disconnect() -> dict:
    """Forget stored tokens (sign out)."""
    oauth.clear_tokens()
    return {"disconnected": True}


# ---- unsubscribe / block operations ----
def _decode_b64url(data: str) -> str:
    try:
        pad = "=" * (-len(data) % 4)
        return base64.urlsafe_b64decode(data + pad).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return ""


def _walk_for_text(payload: dict) -> str:
    """Depth-first collect text/plain; fall back to crude HTML strip."""
    mime = payload.get("mimeType", "")
    body = payload.get("body", {}) or {}
    if mime == "text/plain" and body.get("data"):
        return _decode_b64url(body["data"])
    texts = []
    for part in payload.get("parts", []) or []:
        t = _walk_for_text(part)
        if t:
            texts.append(t)
    if texts:
        return "\n".join(texts)
    if mime == "text/html" and body.get("data"):
        html = _decode_b64url(body["data"])
        return re.sub(r"<[^>]+>", " ", html)
    return ""


def get_message_body(message_id: str, max_chars: int = 4000) -> str:
    """Plain-text body of a message (for parsing statement balances)."""
    msg = _bearer_get(f"/users/me/messages/{message_id}?format=full") or {}
    text = _walk_for_text(msg.get("payload", {}) or {})
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:max_chars]


def get_unsubscribe_info(message_id: str) -> dict:
    """Read the List-Unsubscribe header(s) of a message and classify how we can
    unsubscribe: one-click (RFC 8058), mailto, link, or none."""
    msg = _bearer_get(
        f"/users/me/messages/{message_id}"
        "?format=metadata&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post"
    ) or {}
    headers = {
        h.get("name", "").lower(): h.get("value")
        for h in (msg.get("payload", {}) or {}).get("headers", []) or []
    }
    raw = headers.get("list-unsubscribe") or ""
    post = (headers.get("list-unsubscribe-post") or "").lower()
    https_url, mailto = None, None
    for part in re.findall(r"<([^>]+)>", raw):
        p = part.strip()
        if p.lower().startswith("http") and not https_url:
            https_url = p
        elif p.lower().startswith("mailto:") and not mailto:
            mailto = p
    one_click = bool(https_url and "one-click" in post)
    method = "one_click" if one_click else "mailto" if mailto else "link" if https_url else "none"
    return {"method": method, "https_url": https_url, "mailto": mailto}


def one_click_unsubscribe(url: str) -> bool:
    """RFC 8058 one-click: POST to the sender's endpoint (not a Gmail call)."""
    r = httpx.post(
        url,
        data="List-Unsubscribe=One-Click",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
        follow_redirects=True,
    )
    return r.status_code < 400


def send_unsubscribe_email(mailto: str) -> bool:
    """Send the unsubscribe email a mailto: link asks for (uses compose scope)."""
    parsed = urlparse(mailto)
    to_addr = parsed.path
    q = parse_qs(parsed.query)
    subject = (q.get("subject") or ["unsubscribe"])[0]
    body = (q.get("body") or ["unsubscribe"])[0]
    mime = MIMEText(unquote(body))
    mime["To"] = unquote(to_addr)
    mime["Subject"] = unquote(subject)
    raw = base64.urlsafe_b64encode(mime.as_bytes()).decode()
    _bearer_post("/users/me/messages/send", {"raw": raw})
    return True


def delete_filter(filter_id: str) -> bool:
    """Remove a Gmail filter (undo a Block). 404 is treated as already-gone."""
    r = httpx.delete(
        f"{API_BASE}/users/me/settings/filters/{filter_id}",
        headers={"Authorization": f"Bearer {_token()}"},
        timeout=30,
    )
    if r.status_code == 401:
        raise GmailNotConnected("Gmail token rejected (401) — reconnect.")
    return r.status_code in (200, 204, 404)


def create_block_filter(sender_email: str) -> str:
    """Create a Gmail filter: future mail from sender skips inbox -> trash."""
    resp = _bearer_post("/users/me/settings/filters", {
        "criteria": {"from": sender_email},
        "action": {"removeLabelIds": ["INBOX"], "addLabelIds": ["TRASH"]},
    })
    return resp.get("id", "")


def trash_existing_from(sender_email: str, cap: int = 100) -> int:
    """Move existing mail from a sender to trash. Returns count trashed."""
    data = _bearer_get(
        f"/users/me/messages?q=from:{sender_email}&maxResults={int(cap)}"
    ) or {}
    ids = [m.get("id") for m in (data.get("messages") or []) if m.get("id")]
    n = 0
    for mid in ids:
        try:
            _bearer_post(f"/users/me/messages/{mid}/trash")
            n += 1
        except Exception:  # noqa: BLE001 — skip individual failures
            continue
    return n
