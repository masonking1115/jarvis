import importlib

from backend.modules.agent import service, registry

agent_router = importlib.import_module("backend.modules.agent.router")


class FakeDB:
    def query(self, *a, **k): return self
    def filter(self, *a, **k): return self
    def order_by(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def all(self): return []
    def get(self, *a, **k): return None


def test_render_lists_tools():
    r = registry.render()
    assert "web_search" in r and "navigate" in r and "open_flyover" in r and "weather" in r


def test_plan_parses_action(monkeypatch):
    class P:
        name = "x"
        def chat(self, system, messages, model=None):
            return '{"kind":"action","tool":"weather","args":{"location":"Reno"},"ack":"Yes sir."}'
    monkeypatch.setattr(service, "get_provider", lambda o=None: P())
    out = service.plan(FakeDB(), [{"role": "user", "content": "weather in reno"}])
    assert out["kind"] == "action" and out["tool"] == "weather" and out["args"]["location"] == "Reno"


def test_plan_strips_code_fence(monkeypatch):
    class P:
        name = "x"
        def chat(self, system, messages, model=None):
            return '```json\n{"kind":"reply","text":"hello sir"}\n```'
    monkeypatch.setattr(service, "get_provider", lambda o=None: P())
    out = service.plan(FakeDB(), [{"role": "user", "content": "hi"}])
    assert out["kind"] == "reply" and out["text"] == "hello sir"


def test_plan_unknown_tool_becomes_reply(monkeypatch):
    class P:
        name = "x"
        def chat(self, system, messages, model=None):
            return '{"kind":"action","tool":"launch_rocket","args":{},"ack":"no"}'
    monkeypatch.setattr(service, "get_provider", lambda o=None: P())
    assert service.plan(FakeDB(), [{"role": "user", "content": "hi"}])["kind"] == "reply"


def test_plan_garbage_becomes_reply(monkeypatch):
    class P:
        name = "x"
        def chat(self, system, messages, model=None): return "just chatting, no json"
    monkeypatch.setattr(service, "get_provider", lambda o=None: P())
    out = service.plan(FakeDB(), [{"role": "user", "content": "hi"}])
    assert out["kind"] == "reply" and "just chatting" in out["text"]


def test_run_weather(monkeypatch):
    from backend.modules.flyover import weather as fw, geocode as fg
    monkeypatch.setattr(fg, "geocode", lambda a: {"address": "Reno, NV", "lat": 39.5, "lng": -119.8})
    monkeypatch.setattr(fw, "current", lambda lat, lng, units="imperial": {"temp": 71.3, "description": "clear sky", "main": "Clear"})
    out = service.run(FakeDB(), "weather", {"location": "Reno"})
    assert "71" in out["text"] and "Reno" in out["text"]


def test_run_unknown_tool():
    assert "can't" in service.run(FakeDB(), "nope", {})["text"].lower()
