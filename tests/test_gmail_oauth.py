import base64
import hashlib

from backend.modules.gmail import oauth, client


def test_pkce_challenge_is_s256_of_verifier():
    verifier, challenge = oauth._pkce()
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode()
    assert challenge == expected
    assert "=" not in verifier and "=" not in challenge  # base64url, unpadded


def test_get_access_token_raises_when_no_tokens(monkeypatch):
    monkeypatch.setattr(oauth, "_load", lambda: None)
    try:
        oauth.get_access_token()
        assert False, "expected OAuthError"
    except oauth.OAuthError:
        pass


def test_status_not_configured_without_client(monkeypatch):
    monkeypatch.setattr(client.settings, "google_client_id", "")
    monkeypatch.setattr(client.settings, "google_client_secret", "")
    s = client.status()
    assert s["configured"] is False
    assert s["connected"] is False


def test_status_not_connected_without_tokens(monkeypatch):
    monkeypatch.setattr(client.settings, "google_client_id", "cid")
    monkeypatch.setattr(client.settings, "google_client_secret", "csecret")
    monkeypatch.setattr(oauth, "has_tokens", lambda: False)
    s = client.status()
    assert s["configured"] is True
    assert s["connected"] is False


def test_connect_requires_client(monkeypatch):
    monkeypatch.setattr(client.settings, "google_client_id", "")
    monkeypatch.setattr(client.settings, "google_client_secret", "")
    try:
        client.connect()
        assert False, "expected GmailNotConfigured"
    except client.GmailNotConfigured:
        pass
