import importlib
import json
import pytest

voice_azure = importlib.import_module("backend.modules.voice.azure")
voice_router = importlib.import_module("backend.modules.voice.router")


def test_issue_token_returns_token_and_region(monkeypatch):
    monkeypatch.setattr(voice_azure.settings, "azure_speech_key", "secret-key")
    monkeypatch.setattr(voice_azure.settings, "azure_speech_region", "eastus")

    class R:
        text = "the-jwt"
        def raise_for_status(self): pass
    monkeypatch.setattr(voice_azure.httpx, "post", lambda *a, **k: R())

    tok, region = voice_azure.issue_token()
    assert tok == "the-jwt" and region == "eastus"


def test_issue_token_notconfigured(monkeypatch):
    monkeypatch.setattr(voice_azure.settings, "azure_speech_key", "")
    with pytest.raises(voice_azure.NotConfigured):
        voice_azure.issue_token()


def test_stt_token_endpoint_ok(monkeypatch):
    monkeypatch.setattr(voice_router.azure, "issue_token", lambda: ("jwt", "eastus"))
    assert voice_router.stt_token() == {"token": "jwt", "region": "eastus"}


def test_stt_token_endpoint_unconfigured(monkeypatch):
    def boom(): raise voice_router.azure.NotConfigured("Set AZURE_SPEECH_KEY in backend/.env")
    monkeypatch.setattr(voice_router.azure, "issue_token", boom)
    res = voice_router.stt_token()
    body = json.loads(res.body)
    assert body["available"] is False and "AZURE_SPEECH_KEY" in body["reason"]


def test_config_includes_stt_flag(monkeypatch):
    monkeypatch.setattr(voice_router.settings, "azure_speech_key", "k")
    assert voice_router.config()["stt"] is True
