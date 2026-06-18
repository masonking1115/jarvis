from backend.core import llm


class _FakeMessages:
    def __init__(self, sink): self.sink = sink
    def create(self, **kwargs):
        self.sink["model"] = kwargs["model"]
        class _R:  # minimal anthropic response shape
            content = [type("B", (), {"type": "text", "text": "ok"})()]
        return _R()


def test_anthropic_uses_override_then_default(monkeypatch):
    sink = {}
    p = llm.AnthropicProvider.__new__(llm.AnthropicProvider)  # skip __init__ (no API key)
    p.client = type("C", (), {"messages": _FakeMessages(sink)})()
    p.model = "claude-sonnet-4-6"

    p.chat(system="s", messages=[{"role": "user", "content": "hi"}], model="claude-opus-4-8")
    assert sink["model"] == "claude-opus-4-8"

    p.chat(system="s", messages=[{"role": "user", "content": "hi"}])
    assert sink["model"] == "claude-sonnet-4-6"
