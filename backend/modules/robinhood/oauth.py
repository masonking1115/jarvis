"""Personal OAuth2 + PKCE for SnapTrade (read-only, unattended).

One-time flow: build an authorize URL -> user signs into SnapTrade in their
browser -> SnapTrade redirects to a local loopback listener -> we exchange the
code for an access_token + refresh_token and store them. After that the
refresh_token lets us mint fresh access tokens indefinitely with NO further
user interaction — that is what makes the background sync automatic.

access_token / refresh_token are SECRETS: never logged, printed, or returned by
any endpoint. Stored at data/snaptrade/oauth_tokens.json (data/ is gitignored).
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs

import httpx

from backend.core.config import settings

_DISCOVERY_URL = "https://api.snaptrade.com/.well-known/oauth-authorization-server"
# Confirmed-live fallback if discovery is unreachable.
_FALLBACK = {
    "authorization_endpoint": "https://dashboard.snaptrade.com/oauth/authorize",
    "token_endpoint": "https://api.snaptrade.com/api/v1/oauth/token/",
    "revocation_endpoint": "https://api.snaptrade.com/api/v1/oauth/revoke_token/",
}
_REFRESH_SKEW = 60.0  # refresh this many seconds before the access token expires

_endpoints: dict | None = None
_pending: dict | None = None   # {state, verifier, redirect_uri} for an in-flight sign-in
_server: HTTPServer | None = None
_lock = threading.Lock()


class OAuthError(Exception):
    """Token missing/invalid, or a token-endpoint failure."""


# ---- paths ----
def _data_dir() -> Path:
    p = Path(settings.snaptrade_data_dir)
    if not p.is_absolute():
        p = (Path(__file__).resolve().parent.parent.parent / p).resolve()
    return p


def _tokens_path() -> Path:
    return _data_dir() / "oauth_tokens.json"


# ---- discovery ----
def _discover() -> dict:
    global _endpoints
    if _endpoints is not None:
        return _endpoints
    try:
        r = httpx.get(_DISCOVERY_URL, timeout=15)
        r.raise_for_status()
        d = r.json()
        _endpoints = {
            "authorization_endpoint": d["authorization_endpoint"],
            "token_endpoint": d["token_endpoint"],
            "revocation_endpoint": d.get("revocation_endpoint", _FALLBACK["revocation_endpoint"]),
        }
    except Exception:  # noqa: BLE001 — any failure falls back to known-good endpoints
        _endpoints = dict(_FALLBACK)
    return _endpoints


# ---- token storage ----
def _load() -> dict | None:
    p = _tokens_path()
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:  # noqa: BLE001
        return None


def _save(tok: dict) -> None:
    d = _data_dir()
    d.mkdir(parents=True, exist_ok=True)
    _tokens_path().write_text(json.dumps(tok))


def has_tokens() -> bool:
    t = _load()
    return bool(t and t.get("refresh_token"))


def clear_tokens() -> None:
    p = _tokens_path()
    if p.exists():
        p.unlink()


def token_expiry() -> float | None:
    """Epoch seconds when the current access token expires (for status only)."""
    t = _load()
    return t.get("expires_at") if t else None


# ---- PKCE ----
def _pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


def _redirect_uri() -> str:
    return f"http://127.0.0.1:{settings.snaptrade_redirect_port}/oauth/callback"


# ---- token exchange / refresh ----
def _post_token(data: dict) -> dict:
    ep = _discover()["token_endpoint"]
    r = httpx.post(ep, data=data, headers={"Accept": "application/json"}, timeout=30)
    if r.status_code >= 400:
        raise OAuthError(f"token endpoint {r.status_code}: {r.text[:300]}")
    return r.json()


def _store_token_response(body: dict) -> None:
    existing = _load() or {}
    expires_in = float(body.get("expires_in") or 3600)
    _save({
        "access_token": body["access_token"],
        # refresh responses may omit refresh_token — keep the existing one.
        "refresh_token": body.get("refresh_token") or existing.get("refresh_token"),
        "token_type": body.get("token_type", "Bearer"),
        "expires_at": time.time() + expires_in,
    })


def exchange_code(code: str, verifier: str, redirect_uri: str) -> None:
    body = _post_token({
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": verifier,
        "redirect_uri": redirect_uri,
        "client_id": settings.snaptrade_oauth_client_id,
    })
    _store_token_response(body)


def _refresh() -> None:
    t = _load()
    if not t or not t.get("refresh_token"):
        raise OAuthError("no refresh_token — reconnect required")
    body = _post_token({
        "grant_type": "refresh_token",
        "refresh_token": t["refresh_token"],
        "client_id": settings.snaptrade_oauth_client_id,
    })
    _store_token_response(body)


def get_access_token() -> str:
    """Return a valid access token, refreshing it if near expiry. The auto-refresh
    here is the unattended hook: callers (sync, scheduler) never see the OAuth dance."""
    t = _load()
    if not t or not t.get("access_token"):
        raise OAuthError("not signed in to SnapTrade")
    if time.time() >= (t.get("expires_at", 0) - _REFRESH_SKEW):
        with _lock:
            _refresh()
            t = _load()
    return t["access_token"]


# ---- one-time browser sign-in (loopback) ----
class _CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/oauth/callback":
            self.send_response(404); self.end_headers(); return
        qs = parse_qs(parsed.query)
        code = (qs.get("code") or [None])[0]
        state = (qs.get("state") or [None])[0]
        err = (qs.get("error") or [None])[0]

        ok, msg = False, "Authorization failed."
        pend = _pending
        if err:
            msg = f"Authorization error: {err}"
        elif pend and code and state == pend["state"]:
            try:
                exchange_code(code, pend["verifier"], pend["redirect_uri"])
                ok, msg = True, "SnapTrade connected. You can close this tab and return to JARVIS."
            except Exception as e:  # noqa: BLE001
                msg = f"Token exchange failed: {e}"
        elif state and pend and state != pend["state"]:
            msg = "State mismatch — please retry the connection."

        icon = "✅" if ok else "⚠️"
        html = (
            "<!doctype html><html><body style='font-family:system-ui;background:#0b0b0f;"
            f"color:#eee;padding:4rem;text-align:center'><h2>{icon} {msg}</h2></body></html>"
        )
        self.send_response(200 if ok else 400)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(html.encode())
        # serve_forever() must be stopped from a different thread.
        threading.Thread(target=_shutdown_server, daemon=True).start()

    def log_message(self, *args):  # noqa: D401 — silence default stderr logging
        pass


def _shutdown_server() -> None:
    global _server, _pending
    with _lock:
        srv, _server, _pending = _server, None, None
    if srv is not None:
        try:
            srv.shutdown(); srv.server_close()
        except Exception:  # noqa: BLE001
            pass


def start_authorization() -> str:
    """Start a one-shot loopback listener and return the authorize URL to open."""
    global _pending, _server
    verifier, challenge = _pkce()
    state = secrets.token_urlsafe(24)
    redirect_uri = _redirect_uri()

    with _lock:
        if _server is not None:  # tear down any stale in-flight attempt
            try:
                _server.shutdown(); _server.server_close()
            except Exception:  # noqa: BLE001
                pass
            _server = None
        _pending = {"state": state, "verifier": verifier, "redirect_uri": redirect_uri}
        srv = HTTPServer(("127.0.0.1", settings.snaptrade_redirect_port), _CallbackHandler)
        _server = srv
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    params = {
        "response_type": "code",
        "client_id": settings.snaptrade_oauth_client_id,
        "redirect_uri": redirect_uri,
        "scope": "read",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return f"{_discover()['authorization_endpoint']}?{urlencode(params)}"
