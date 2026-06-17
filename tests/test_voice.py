import importlib

from backend.modules.voice import azure
from backend.core.config import settings as app_settings

# The packages re-export `router` (the APIRouter), which shadows the `router`
# submodule attribute — so fetch the real modules from sys.modules via importlib.
voice_router = importlib.import_module("backend.modules.voice.router")
chat_router = importlib.import_module("backend.modules.chat.router")


def test_config_degrades(monkeypatch):
    monkeypatch.setattr(app_settings, "azure_speech_key", "")
    assert voice_router.config()["available"] is False


def test_synthesize_builds_ssml(monkeypatch):
    monkeypatch.setattr(app_settings, "azure_speech_key", "SECRET_KEY")
    monkeypatch.setattr(app_settings, "jarvis_voice", "en-GB-RyanNeural")
    captured = {}

    class FakeResp:
        content = b"MP3DATA"
        def raise_for_status(self): pass

    def fake_post(url, headers=None, content=None, timeout=None):
        captured["url"] = url; captured["headers"] = headers; captured["content"] = content
        return FakeResp()

    monkeypatch.setattr(azure.httpx, "post", fake_post)
    out = azure.synthesize("Hello <sir> & welcome")
    assert out == b"MP3DATA"
    body = captured["content"].decode()
    assert "en-GB-RyanNeural" in body
    assert "&lt;sir&gt;" in body and "&amp;" in body          # XML-escaped
    assert captured["headers"]["Ocp-Apim-Subscription-Key"] == "SECRET_KEY"


def test_not_configured(monkeypatch):
    monkeypatch.setattr(app_settings, "azure_speech_key", "")
    try:
        azure.synthesize("hi"); assert False
    except azure.NotConfigured:
        pass


def test_chat_voice_flag_tightens_system(monkeypatch):
    seen = {}

    class FakeProvider:
        name = "fake"
        def chat(self, system, messages, model=None): seen["system"] = system; seen["model"] = model; return "ok"

    monkeypatch.setattr(chat_router, "get_provider", lambda p=None: FakeProvider())

    class FakeDB:  # _build_context only does read queries; stub them out
        def query(self, *a, **k): return self
        def filter(self, *a, **k): return self
        def order_by(self, *a, **k): return self
        def limit(self, *a, **k): return self
        def all(self): return []

    req = chat_router.ChatRequest(messages=[chat_router.ChatMessage(role="user", content="hi")], voice=True)
    class FakeBG:
        def add_task(self, *a, **k): pass
    chat_router.chat(req, background=FakeBG(), db=FakeDB())
    assert "spoken dialogue" in seen["system"]
    assert seen["model"] == app_settings.voice_model     # voice uses the faster model


def test_load_persona_uses_file(monkeypatch, tmp_path):
    p = tmp_path / "prof.md"; p.write_text("CUSTOM PERSONA RULES", encoding="utf-8")
    monkeypatch.setattr(app_settings, "jarvis_profile_path", str(p))
    assert chat_router.load_persona() == "CUSTOM PERSONA RULES"


def test_load_persona_fallback(monkeypatch, tmp_path):
    monkeypatch.setattr(app_settings, "jarvis_profile_path", str(tmp_path / "missing.md"))
    assert chat_router.load_persona() == chat_router.DEFAULT_PERSONA
