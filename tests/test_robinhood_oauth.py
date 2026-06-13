import base64
import hashlib

from backend.modules.robinhood import oauth, client


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


def test_status_not_connected_without_tokens(monkeypatch):
    monkeypatch.setattr(oauth, "has_tokens", lambda: False)
    s = client.status()
    assert s["configured"] is True
    assert s["connected"] is False


def test_fetch_normalized_requires_connection(monkeypatch):
    monkeypatch.setattr(oauth, "has_tokens", lambda: False)
    try:
        client.fetch_normalized()
        assert False, "expected SnapTradeNotConnected"
    except client.SnapTradeNotConnected:
        pass
