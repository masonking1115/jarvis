import base64
import importlib
from fastapi import FastAPI
from fastapi.testclient import TestClient

# import the submodule directly (package __init__ binds `router` to the APIRouter,
# which would otherwise shadow the module for `import ... .router as vr`).
vr = importlib.import_module("backend.modules.vision.router")

app = FastAPI()
app.include_router(vr.router, prefix="/api/vision")
client = TestClient(app)

# 1x1 white JPEG-ish bytes are fine for the base64-validity check (we mock the model).
_B64 = base64.b64encode(b"\xff\xd8\xff\xe0fakejpeg").decode()


def test_config_reports_availability(monkeypatch):
    monkeypatch.setattr(vr.settings, "anthropic_api_key", "sk-test")
    assert client.get("/api/vision/config").json()["available"] is True
    monkeypatch.setattr(vr.settings, "anthropic_api_key", "")
    assert client.get("/api/vision/config").json()["available"] is False


def test_look_calls_vision_and_strips_data_url(monkeypatch):
    monkeypatch.setattr(vr.settings, "anthropic_api_key", "sk-test")
    seen = {}

    class _FakeProvider:
        def vision(self, question, image_b64, media_type="image/jpeg", **k):
            seen["q"] = question; seen["data"] = image_b64; seen["mt"] = media_type
            return "a desk with a laptop"

    import backend.core.llm as llm
    monkeypatch.setattr(llm, "AnthropicProvider", lambda: _FakeProvider())

    r = client.post("/api/vision/look", json={"image": f"data:image/png;base64,{_B64}", "question": "what is this?"})
    assert r.json()["text"] == "a desk with a laptop"
    assert seen["q"] == "what is this?"
    assert seen["data"] == _B64        # data: prefix stripped
    assert seen["mt"] == "image/png"   # media type parsed from the data URL


def test_look_unconfigured_is_graceful(monkeypatch):
    monkeypatch.setattr(vr.settings, "anthropic_api_key", "")
    assert "isn't configured" in client.post("/api/vision/look", json={"image": _B64}).json()["text"]


def test_look_rejects_garbage_image(monkeypatch):
    monkeypatch.setattr(vr.settings, "anthropic_api_key", "sk-test")
    assert "didn't come through" in client.post("/api/vision/look", json={"image": "!!!not base64!!!"}).json()["text"]
