from backend.core import llm


def test_agent_text_strips_key_and_returns_stdout(monkeypatch):
    p = llm.ClaudeCliProvider.__new__(llm.ClaudeCliProvider)
    p.path = "claude"; p.available = True; p.model = "opus"

    captured = {}

    class _Proc:
        returncode = 0
        stdout = "the agent answer"
        stderr = ""

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["env"] = kwargs["env"]
        return _Proc()

    monkeypatch.setattr(llm.subprocess, "run", fake_run, raising=False)
    import subprocess as _sp
    monkeypatch.setattr(_sp, "run", fake_run)

    out = p.agent_text("do the thing", context="ctx")
    assert out == "the agent answer"
    assert "bypassPermissions" in captured["cmd"]
    assert "ANTHROPIC_API_KEY" not in captured["env"]


def test_agent_stream_yields_parsed_events(monkeypatch):
    p = llm.ClaudeCliProvider.__new__(llm.ClaudeCliProvider)
    p.path = "claude"; p.available = True; p.model = "opus"

    lines = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
        '{"type":"result","result":"hi"}',
    ]

    class _Popen:
        def __init__(self, *a, **k): self.stdout = iter(lines); self.returncode = 0
        def wait(self, timeout=None): return 0
        def kill(self): pass

    import subprocess as _sp
    monkeypatch.setattr(_sp, "Popen", _Popen)

    events = list(p.agent_stream("q", context="ctx"))
    assert events[0] == {"type": "text", "text": "hi"}
    assert events[-1]["type"] == "done"
