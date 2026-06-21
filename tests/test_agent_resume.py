import subprocess
from backend.core import llm


def _fake_popen(captured):
    class _P:
        def __init__(self, cmd, **kw):
            captured["cmd"] = cmd
            captured["env"] = kw.get("env", {})
            self.stdout = iter([
                '{"type":"system","subtype":"init","session_id":"sid-9"}',
                '{"type":"result","result":"done"}',
            ])
            self.returncode = 0
        def wait(self, timeout=None): return 0
        def kill(self): pass
    return _P


def test_agent_stream_adds_resume_and_hardening(monkeypatch):
    p = llm.ClaudeCliProvider.__new__(llm.ClaudeCliProvider)
    p.path = "claude"; p.available = True; p.model = "sonnet"
    captured = {}
    monkeypatch.setattr(subprocess, "Popen", _fake_popen(captured))

    events = list(p.agent_stream("hi", context="ctx", session_id="sid-1"))
    cmd = captured["cmd"]
    assert "--resume" in cmd and cmd[cmd.index("--resume") + 1] == "sid-1"
    assert "acceptEdits" in cmd
    assert "--max-turns" in cmd
    assert "--allowedTools" in cmd and "Bash" in cmd
    assert "--disallowedTools" in cmd
    assert "ANTHROPIC_API_KEY" not in captured["env"]      # Max-plan auth
    assert any(e["type"] == "session" for e in events)


def test_agent_stream_omits_resume_when_no_session(monkeypatch):
    p = llm.ClaudeCliProvider.__new__(llm.ClaudeCliProvider)
    p.path = "claude"; p.available = True; p.model = "sonnet"
    captured = {}
    monkeypatch.setattr(subprocess, "Popen", _fake_popen(captured))
    list(p.agent_stream("hi"))
    assert "--resume" not in captured["cmd"]


def test_agent_stream_uses_given_cwd_and_allows_notion(monkeypatch):
    p = llm.ClaudeCliProvider.__new__(llm.ClaudeCliProvider)
    p.path = "claude"; p.available = True; p.model = "sonnet"
    captured = {}
    class _P:
        def __init__(self, cmd, **kw): captured["cmd"] = cmd; captured["cwd"] = kw.get("cwd"); self.stdout = iter(['{"type":"result","result":"ok"}']); self.returncode = 0
        def wait(self, timeout=None): return 0
        def kill(self): pass
    monkeypatch.setattr(subprocess, "Popen", _P)
    list(p.agent_stream("hi", cwd=r"C:\tmp\proj"))
    assert captured["cwd"] == r"C:\tmp\proj"
    assert any("notion-create-pages" in t for t in captured["cmd"])
