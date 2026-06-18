# JARVIS Tiered Brain + Streaming Deep-Agent + Voice — Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give JARVIS a three-tier brain (fast / smart / agent) with non-blocking escalation to the full autonomous Claude CLI agent, reachable from voice — the foundation the chat surface (Plan B) builds on.

**Architecture:** Extend the existing single-shot planner (`agent/service.plan`) with a `tier` arg and a new `escalate` decision. Add a streaming + non-streaming agentic run to `ClaudeCliProvider` (Max plan, full toolset, `bypassPermissions`), with a pure stream-json line parser. Voice escalation runs the agent as a tracked **background job** so the interaction layer never freezes, weaving the result in at the next natural pause.

**Tech Stack:** FastAPI, SQLAlchemy, pydantic-settings, the `claude` CLI (Max plan), Next.js/React (voice client), pytest.

**Spec:** `docs/superpowers/specs/2026-06-17-jarvis-tiered-brain-chat-design.md`

> **Decomposition note:** the spec placed the voice background-job endpoint under `/api/chat`. To keep this plan self-contained (no chat-module dependency), it lives at **`/api/agent/deep`** here; Plan B's chat reuses the same provider methods and job runner.

---

### Task 1: Config — smart & agent model ids

**Files:**
- Modify: `backend/core/config.py:22` (after `agent_search_model`)

- [ ] **Step 1: Add the settings**

In `backend/core/config.py`, after the `agent_search_model` line, add:

```python
    smart_model: str = "claude-opus-4-8"  # API model id for the "smart" tier (Opus)
    agent_model: str = "opus"             # CLI alias for the autonomous "agent" tier
```

- [ ] **Step 2: Verify import still works**

Run: `python -c "from backend.core.config import settings; print(settings.smart_model, settings.agent_model)"`
Expected: `claude-opus-4-8 opus`

- [ ] **Step 3: Commit**

```bash
git add backend/core/config.py
git commit -m "feat(config): add smart_model and agent_model tier settings"
```

---

### Task 2: AnthropicProvider honors model override

The smart tier needs Opus while the default stays Sonnet. Today `AnthropicProvider.chat` ignores the `model` arg.

**Files:**
- Modify: `backend/core/llm.py:21-29`
- Test: `tests/test_llm_override.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_llm_override.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_llm_override.py -v`
Expected: FAIL — current code always passes `self.model`, so the first assert fails.

- [ ] **Step 3: Implement**

In `backend/core/llm.py`, change `AnthropicProvider.chat`:

```python
    def chat(self, system: str, messages: list[dict], model: str | None = None) -> str:
        resp = self.client.messages.create(
            model=model or self.model,   # honor override (smart tier = Opus); default Sonnet
            max_tokens=1024,
            system=system,
            messages=messages,
        )
        parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
        return "".join(parts).strip()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_llm_override.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/core/llm.py tests/test_llm_override.py
git commit -m "feat(llm): AnthropicProvider honors model override for smart tier"
```

---

### Task 3: Spike — capture real stream-json output

The parser must be built against the CLI's real event schema, not assumptions. This task captures a fixture.

**Files:**
- Create: `tests/fixtures/stream_json_sample.jsonl`

- [ ] **Step 1: Run the CLI in stream-json mode and save output**

Run (from the project root; PowerShell):

```powershell
claude -p "Make a 2-item todo list with TodoWrite, then say done." `
  --output-format stream-json --verbose --include-partial-messages `
  --permission-mode bypassPermissions --model opus `
  | Out-File -Encoding utf8 tests/fixtures/stream_json_sample.jsonl
```

If a flag is rejected, drop `--include-partial-messages` first, then `--verbose`, and note which flags the installed CLI accepts in the commit message. The captured file is the source of truth for Task 4.

- [ ] **Step 2: Inspect the event shapes**

Read `tests/fixtures/stream_json_sample.jsonl`. Confirm you can identify: assistant text events, a `tool_use` block named `TodoWrite` (with `input.todos`), other `tool_use` blocks, and the final `result` event. Note the exact field paths.

- [ ] **Step 3: Commit the fixture**

```bash
git add tests/fixtures/stream_json_sample.jsonl
git commit -m "test(fixture): capture real claude stream-json output for parser"
```

---

### Task 4: Pure stream-json line parser

A pure function (iterable of JSON lines → normalized events) so it is unit-testable without a subprocess.

**Files:**
- Create: `backend/core/stream_parse.py`
- Test: `tests/test_stream_parse.py`

- [ ] **Step 1: Write the failing test**

Use a small hand-written fixture mirroring the real shapes confirmed in Task 3. (If Task 3's real field paths differ, adjust both this fixture and the parser together.)

```python
# tests/test_stream_parse.py
from backend.core.stream_parse import parse_stream_lines

LINES = [
    '{"type":"system","subtype":"init"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Working"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TodoWrite",'
    '"input":{"todos":[{"content":"step one","status":"in_progress"},'
    '{"content":"step two","status":"pending"}]}}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read",'
    '"input":{"file_path":"a.py"}}]}}',
    '{"type":"result","subtype":"success","result":"All done"}',
    "",  # blank line must be skipped, not crash
]


def test_parse_emits_text_todos_tool_done():
    events = list(parse_stream_lines(iter(LINES)))
    types = [e["type"] for e in events]
    assert types == ["text", "todos", "tool", "done"]
    assert events[0]["text"] == "Working"
    assert events[1]["todos"] == [
        {"content": "step one", "status": "in_progress"},
        {"content": "step two", "status": "pending"},
    ]
    assert events[2]["name"] == "Read"
    # the final result text is carried on the done event for callers that want it
    assert events[3].get("text") == "All done"


def test_parse_tolerates_garbage_lines():
    events = list(parse_stream_lines(iter(["not json", '{"type":"result","result":"ok"}'])))
    assert events[-1] == {"type": "done", "text": "ok"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_stream_parse.py -v`
Expected: FAIL — `backend.core.stream_parse` does not exist.

- [ ] **Step 3: Implement**

```python
# backend/core/stream_parse.py
"""Translate the Claude CLI's stream-json events into normalized UI events.

Pure over an iterable of raw JSONL lines so it is testable without a subprocess.
Emitted event dicts:
  {"type":"text","text": <str>}                      assistant text
  {"type":"todos","todos":[{content,status}, ...]}   a TodoWrite tool call
  {"type":"tool","name": <str>, "summary": <str>}    any other tool call
  {"type":"done","text": <final result str>}         terminal event
"""
from __future__ import annotations

import json
from typing import Iterable, Iterator


def _tool_summary(name: str, inp: dict) -> str:
    for key in ("file_path", "path", "query", "command", "url", "pattern"):
        if isinstance(inp, dict) and inp.get(key):
            return f"{name} {inp[key]}"
    return name


def parse_stream_lines(lines: Iterable[str]) -> Iterator[dict]:
    final = ""
    for raw in lines:
        s = (raw or "").strip()
        if not s:
            continue
        try:
            ev = json.loads(s)
        except (ValueError, TypeError):
            continue
        etype = ev.get("type")
        if etype == "assistant":
            for block in (ev.get("message") or {}).get("content", []) or []:
                btype = block.get("type")
                if btype == "text" and block.get("text"):
                    yield {"type": "text", "text": block["text"]}
                elif btype == "tool_use":
                    name = block.get("name") or "tool"
                    inp = block.get("input") or {}
                    if name == "TodoWrite":
                        todos = [
                            {"content": t.get("content", ""), "status": t.get("status", "pending")}
                            for t in inp.get("todos", [])
                        ]
                        yield {"type": "todos", "todos": todos}
                    else:
                        yield {"type": "tool", "name": name, "summary": _tool_summary(name, inp)}
        elif etype == "stream_event":
            # token-level delta when --include-partial-messages is active
            delta = (ev.get("event") or {}).get("delta") or {}
            if delta.get("type") == "text_delta" and delta.get("text"):
                yield {"type": "text", "text": delta["text"]}
        elif etype == "result":
            final = ev.get("result") or final
    yield {"type": "done", "text": final}
```

> If Task 3 showed `--include-partial-messages` emits a different `stream_event` shape, align the `stream_event` branch with the captured fixture and add a fixture-driven assertion.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_stream_parse.py -v`
Expected: PASS

- [ ] **Step 5: Add a fixture-driven smoke test**

Append to `tests/test_stream_parse.py`:

```python
from pathlib import Path


def test_parse_real_fixture_ends_with_done():
    fx = Path(__file__).parent / "fixtures" / "stream_json_sample.jsonl"
    if not fx.exists():
        return  # spike fixture optional in CI
    events = list(parse_stream_lines(fx.read_text(encoding="utf-8").splitlines()))
    assert events and events[-1]["type"] == "done"
```

Run: `python -m pytest tests/test_stream_parse.py -v` → PASS

- [ ] **Step 6: Commit**

```bash
git add backend/core/stream_parse.py tests/test_stream_parse.py
git commit -m "feat(core): pure stream-json parser for the agent tier"
```

---

### Task 5: ClaudeCliProvider — agent_text + agent_stream

**Files:**
- Modify: `backend/core/llm.py` (add two methods to `ClaudeCliProvider`)
- Test: `tests/test_agent_provider.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_agent_provider.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_agent_provider.py -v`
Expected: FAIL — `agent_text`/`agent_stream` not defined.

- [ ] **Step 3: Implement**

Add to `ClaudeCliProvider` in `backend/core/llm.py` (and add `from pathlib import Path` is not needed; reuse existing inline imports). First add a module-level import near the top of the file:

```python
from .stream_parse import parse_stream_lines
```

Then the methods:

```python
    def _project_cwd(self) -> str:
        # Run in the project root so the agent has the codebase + local data and
        # uses TodoWrite naturally (loads the project CLAUDE.md — intended).
        import os
        return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    def agent_text(self, prompt: str, context: str = "", model: str | None = None,
                   timeout: int = 180) -> str:
        """Non-streaming autonomous agent run (used by voice). Full toolset, no gates."""
        if not self.available:
            raise RuntimeError("claude CLI not found on PATH")
        import os, subprocess
        env = {k: v for k, v in os.environ.items()
               if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
        cmd = [self.path, "-p", prompt, "--output-format", "text",
               "--permission-mode", "bypassPermissions",
               "--model", (model or self.model)]
        if context:
            cmd[3:3] = ["--append-system-prompt", context]
        proc = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
            env=env, cwd=self._project_cwd(), timeout=timeout,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"agent run failed ({proc.returncode}): {proc.stderr[:300]}")
        return proc.stdout.strip().replace("�", "-")

    def agent_stream(self, prompt: str, context: str = "", model: str | None = None,
                     timeout: int = 300):
        """Streaming autonomous agent run (used by chat). Yields normalized events."""
        if not self.available:
            yield {"type": "text", "text": "The agent is unavailable, sir."}
            yield {"type": "done", "text": ""}
            return
        import os, subprocess
        env = {k: v for k, v in os.environ.items()
               if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
        cmd = [self.path, "-p", prompt,
               "--output-format", "stream-json", "--verbose", "--include-partial-messages",
               "--permission-mode", "bypassPermissions",
               "--model", (model or self.model)]
        if context:
            cmd[3:3] = ["--append-system-prompt", context]
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", errors="replace",
            env=env, cwd=self._project_cwd(),
        )
        try:
            yield from parse_stream_lines(proc.stdout)
        except Exception:  # noqa: BLE001 — never leak; close cleanly
            yield {"type": "text", "text": "I ran into a problem with that, sir."}
            yield {"type": "done", "text": ""}
        finally:
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass
```

> Note: `parse_stream_lines` already emits a terminal `done`, so the normal path ends correctly; the except/finally guard only the abnormal path.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_agent_provider.py -v`
Expected: PASS

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `python -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/core/llm.py tests/test_agent_provider.py
git commit -m "feat(llm): autonomous agent_text + streaming agent_stream (bypassPermissions)"
```

---

### Task 6: Dispatcher — tier param, escalate, smart tier

**Files:**
- Modify: `backend/modules/agent/service.py:15-70`
- Test: `tests/test_tier_dispatch.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_tier_dispatch.py
import json
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.db import Base
import backend.modules.agent.service as svc


@pytest.fixture
def db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    yield sessionmaker(bind=eng)()


class _FakeProvider:
    def __init__(self, payload): self.payload = payload; self.seen = {}
    def chat(self, system, messages, model=None):
        self.seen["model"] = model; self.seen["system"] = system
        return self.payload


def test_plan_returns_escalate(db, monkeypatch):
    fake = _FakeProvider(json.dumps({"kind": "escalate", "reason": "multi-step"}))
    monkeypatch.setattr(svc, "get_provider", lambda *a, **k: fake)
    monkeypatch.setattr(svc, "load_persona", lambda: "P")
    out = svc.plan(db, [{"role": "user", "content": "analyze my whole finances"}])
    assert out["kind"] == "escalate"


def test_forced_agent_tier_returns_escalate_without_routing(db, monkeypatch):
    # Should NOT call the planner at all when tier='agent'.
    def _boom(*a, **k): raise AssertionError("planner should be skipped")
    monkeypatch.setattr(svc, "get_provider", _boom)
    out = svc.plan(db, [{"role": "user", "content": "x"}], tier="agent")
    assert out["kind"] == "escalate"


def test_smart_tier_uses_smart_model(db, monkeypatch):
    fake = _FakeProvider("a thoughtful answer")
    monkeypatch.setattr(svc, "get_provider", lambda *a, **k: fake)
    monkeypatch.setattr(svc, "load_persona", lambda: "P")
    out = svc.plan(db, [{"role": "user", "content": "think about x"}], tier="smart")
    assert out == {"kind": "reply", "text": "a thoughtful answer"}
    assert fake.seen["model"] == svc.settings.smart_model
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_tier_dispatch.py -v`
Expected: FAIL — `plan` has no `tier` param; no escalate handling.

- [ ] **Step 3: Implement**

In `backend/modules/agent/service.py`, extend `_PLAN_INSTRUCTION` to include the escalate option:

```python
_PLAN_INSTRUCTION = (
    "Decide what the user's latest message needs, using the actions and skills listed above.\n"
    "Respond with ONLY a JSON object — no prose, no code fences:\n"
    '- Plain answer: {"kind":"reply","text":"<concise spoken answer>"}\n'
    '- Action: {"kind":"action","tool":"<one of the action names>","args":{...},'
    '"ack":"<short spoken acknowledgement>"}\n'
    '- Specialized skill: {"kind":"skill","name":"<one of the skill names>"}\n'
    '- Escalate: {"kind":"escalate","reason":"<why>"} — use when the request needs '
    "multiple steps, reading files or the user's own data, web research plus synthesis, "
    "or deep analysis a single reply can't do well.\n"
    "Prefer a skill when the request matches its description; an action when it matches one; "
    "escalate for genuinely hard/multi-step work; otherwise reply. If the user explicitly "
    "names a skill, use that skill.\n"
    "Be proactive: connect the user's known facts and goals to the moment and suggest or take "
    "the next concrete step toward a goal (confirming anything irreversible first)."
)
```

Update `_parse` to accept `escalate`:

```python
            if isinstance(obj, dict) and obj.get("kind") in ("reply", "action", "skill", "escalate"):
                return obj
```

Add a smart-tier helper and rework `plan`:

```python
def _smart_answer(db: Session, messages: list[dict]) -> dict:
    from backend.modules.skills import service as skills_service
    provider = get_provider()
    facts = profile_storage.get_context(db)
    system = load_persona()
    if facts:
        system += "\n\n" + facts
    system += "\n\n" + skills_service.router_context(db)
    text = provider.chat(system=system, messages=messages, model=settings.smart_model)
    return {"kind": "reply", "text": (text or "").strip() or "I'm not sure, sir."}


def plan(db: Session, messages: list[dict], skill: str | None = None,
         tier: str | None = None) -> dict:
    from backend.modules.skills import service as skills_service
    if skill:
        return skills_service.answer(db, skill, messages)
    if tier == "agent":
        return {"kind": "escalate", "reason": "forced agent tier"}
    if tier == "smart":
        return _smart_answer(db, messages)

    provider = get_provider()
    facts = profile_storage.get_context(db)
    system = load_persona()
    if facts:
        system += "\n\n" + facts
    system += "\n\n" + skills_service.router_context(db) + "\n\n" + _PLAN_INSTRUCTION
    raw = provider.chat(system=system, messages=messages, model=settings.voice_model)
    out = _parse(raw)

    if out.get("kind") == "skill":
        name = out.get("name")
        if any(s.name == name for s in skills_service.registry.enabled_instruction_skills(db)):
            return skills_service.answer(db, name, messages)
        return {"kind": "reply", "text": "I'm not sure how to help with that, sir."}
    if out.get("kind") == "action" and out.get("tool") not in registry.NAMES:
        return {"kind": "reply", "text": out.get("ack") or "I can't do that yet, sir."}
    return out  # reply | action | escalate
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_tier_dispatch.py -v`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest -q`
Expected: all pass (existing planner tests unaffected — fast path unchanged).

- [ ] **Step 6: Commit**

```bash
git add backend/modules/agent/service.py tests/test_tier_dispatch.py
git commit -m "feat(agent): tier param, escalate decision, smart tier"
```

---

### Task 7: Agent router — tier field + deep-agent background job

**Files:**
- Modify: `backend/modules/agent/router.py`
- Test: `tests/test_deep_job.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_deep_job.py
import time
from fastapi.testclient import TestClient
from backend.main import app
import backend.modules.agent.router as ar

client = TestClient(app)


def test_deep_job_lifecycle(monkeypatch):
    monkeypatch.setattr(ar, "_agent_text", lambda prompt, context: "deep answer")
    r = client.post("/api/agent/deep", json={"messages": [{"role": "user", "content": "go deep"}]})
    assert r.status_code == 200
    job_id = r.json()["job_id"]

    for _ in range(50):
        g = client.get(f"/api/agent/deep/{job_id}").json()
        if g["status"] == "done":
            break
        time.sleep(0.02)
    assert g["status"] == "done"
    assert g["text"] == "deep answer"


def test_deep_job_unknown_id():
    assert client.get("/api/agent/deep/nope").json()["status"] == "error"


def test_plan_accepts_tier(monkeypatch):
    import backend.modules.agent.service as svc
    monkeypatch.setattr(svc, "plan", lambda db, msgs, skill=None, tier=None: {"kind": "escalate", "reason": tier})
    r = client.post("/api/agent/plan", json={"messages": [{"role": "user", "content": "x"}], "tier": "agent"})
    assert r.json() == {"kind": "escalate", "reason": "agent"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_deep_job.py -v`
Expected: FAIL — no `tier` field, no `/deep` routes, no `_agent_text`.

- [ ] **Step 3: Implement**

Rewrite `backend/modules/agent/router.py`:

```python
"""Agent endpoints (/api/agent): plan, run, and the autonomous deep-agent job."""
import threading
import uuid

from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from backend.core.llm import ClaudeCliProvider
from backend.modules.chat.router import load_persona, _build_context
from backend.modules.profile.extract import extract_in_background
from . import service, registry

router = APIRouter()

# In-process job store — single-user local app, so a dict is sufficient.
_JOBS: dict[str, dict] = {}


class Msg(BaseModel):
    role: str
    content: str


class PlanIn(BaseModel):
    messages: list[Msg]
    skill: str | None = None
    tier: str | None = None   # None -> route; "smart" | "agent" -> forced tier


class RunIn(BaseModel):
    tool: str
    args: dict = {}


class DeepIn(BaseModel):
    messages: list[Msg]


def _agent_text(prompt: str, context: str) -> str:
    """Indirection so tests can monkeypatch the CLI call."""
    return ClaudeCliProvider().agent_text(prompt, context=context)


def _run_job(job_id: str, prompt: str, context: str) -> None:
    try:
        _JOBS[job_id] = {"status": "done", "text": _agent_text(prompt, context)}
    except Exception as exc:  # noqa: BLE001 — surface a safe message, never raise
        _JOBS[job_id] = {"status": "error", "text": "I ran into a problem with that, sir."}


@router.get("/tools")
def tools():
    return {"tools": registry.TOOLS}


@router.post("/plan")
def plan(body: PlanIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    msgs = [{"role": m.role, "content": m.content} for m in body.messages]
    result = service.plan(db, msgs, skill=body.skill, tier=body.tier)
    last_user = next((m["content"] for m in reversed(msgs) if m["role"] == "user"), "")
    assistant_text = result.get("text") or result.get("ack") or ""
    if last_user and assistant_text:
        background.add_task(extract_in_background, last_user, assistant_text)
    return result


@router.post("/run")
def run(body: RunIn, db: Session = Depends(get_db)):
    return service.run(db, body.tool, body.args)


@router.post("/deep")
def deep(body: DeepIn, db: Session = Depends(get_db)):
    """Start a non-blocking autonomous agent run; returns a job id to poll."""
    msgs = [{"role": m.role, "content": m.content} for m in body.messages]
    prompt = "\n\n".join(f"{m['role']}: {m['content']}" for m in msgs)  # full conversation
    context = f"{load_persona()}\n\n{_build_context(db)}"
    job_id = uuid.uuid4().hex
    _JOBS[job_id] = {"status": "running", "text": ""}
    threading.Thread(target=_run_job, args=(job_id, prompt, context), daemon=True).start()
    return {"job_id": job_id}


@router.get("/deep/{job_id}")
def deep_status(job_id: str):
    return _JOBS.get(job_id, {"status": "error", "text": "unknown job"})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_deep_job.py -v`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/agent/router.py tests/test_deep_job.py
git commit -m "feat(agent): tier field on /plan + non-blocking /deep agent job"
```

---

### Task 8: Voice — "think hard" phrase + non-blocking escalation

The voice client forces the agent tier on a phrase, and handles an `escalate` plan result by acking immediately, polling the `/deep` job, and speaking the result at the next idle moment.

**Files:**
- Modify: `web/lib/voice.ts` (add `wantsDeep`)
- Modify: `web/components/voice/VoiceProvider.tsx` (escalate handling)
- Modify: `web/lib/api.ts` (add `agent.deep` / `agent.deepStatus`)
- Create: `web/check_deep_phrase.ts` (assertion)

- [ ] **Step 1: Write the failing assertion for the phrase helper**

```typescript
// web/check_deep_phrase.ts — run: npx tsx web/check_deep_phrase.ts
import { wantsDeep } from "./lib/voice";

const cases: [string, boolean][] = [
  ["think hard about my finances", true],
  ["go deep on this", true],
  ["really think about the tradeoffs", true],
  ["what's the weather", false],
  ["open finance", false],
];
for (const [input, expected] of cases) {
  const got = wantsDeep(input);
  if (got !== expected) throw new Error(`wantsDeep(${input}) = ${got}, expected ${expected}`);
}
console.log("wantsDeep: all cases pass");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web; npx tsx check_deep_phrase.ts`
Expected: FAIL — `wantsDeep` is not exported.

- [ ] **Step 3: Implement `wantsDeep` in `web/lib/voice.ts`**

Add near `extractCommand`:

```typescript
const DEEP_PHRASES = ["think hard", "go deep", "really think", "deep dive", "work on it"];

/** True when the user explicitly asks JARVIS to think harder (force the agent tier). */
export function wantsDeep(text: string): boolean {
  const t = (text || "").toLowerCase();
  return DEEP_PHRASES.some(p => t.includes(p));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web; npx tsx check_deep_phrase.ts`
Expected: `wantsDeep: all cases pass`

- [ ] **Step 5: Add the API client methods in `web/lib/api.ts`**

Add to the `api` object (alongside existing clients):

```typescript
  agent: {
    plan: (messages: { role: string; content: string }[], tier?: string) =>
      api.post<any>("/api/agent/plan", { messages, tier }),
    deep: (messages: { role: string; content: string }[]) =>
      api.post<{ job_id: string }>("/api/agent/deep", { messages }),
    deepStatus: (jobId: string) =>
      api.get<{ status: "running" | "done" | "error"; text: string }>(`/api/agent/deep/${jobId}`),
  },
```

(Use the file's existing `api.post`/`api.get` helpers and matching style.)

- [ ] **Step 6: Wire escalation into `web/components/voice/VoiceProvider.tsx`**

Where a recognized command is currently sent to the planner, force the tier when the phrase is present and handle an `escalate` result with a background poll. Add this helper inside the provider and call it from the command handler:

```typescript
// Poll a deep-agent job and speak the result once the user is idle (non-blocking).
async function runDeepAgent(messages: { role: string; content: string }[]) {
  speak("Let me think on that, sir — I'll keep going while I do.");
  try {
    const { job_id } = await api.agent.deep(messages);
    const poll = async (): Promise<void> => {
      const s = await api.agent.deepStatus(job_id);
      if (s.status === "running") { setTimeout(poll, 1500); return; }
      // Deliver at the next natural pause: only speak when not capturing/speaking.
      const deliver = () => {
        if (stateRef.current === "capturing" || stateRef.current === "speaking") {
          setTimeout(deliver, 600); return;
        }
        speak(s.text || "I couldn't complete that, sir.");
      };
      deliver();
    };
    setTimeout(poll, 1500);
  } catch {
    speak("I ran into a problem with that, sir.");
  }
}
```

Then in the existing command handler, replace the direct plan call so it forces the tier and routes escalation:

```typescript
const deep = wantsDeep(command);
const result = await api.agent.plan(convo, deep ? "agent" : undefined);
if (result.kind === "escalate") { await runDeepAgent(convo); return; }
// ...existing handling of reply / action / skill unchanged...
```

> Implementer notes: `stateRef` is the existing state-machine ref (idle/capturing/thinking/speaking); reuse the provider's existing `speak()` and the message array it already assembles (`convo`). Do not change the state machine itself. If the provider lacks a `stateRef`, add a `useRef` mirroring the existing state variable.

- [ ] **Step 7: Typecheck**

Run: `cd web; npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add web/lib/voice.ts web/components/voice/VoiceProvider.tsx web/lib/api.ts web/check_deep_phrase.ts
git commit -m "feat(voice): 'think hard' phrase + non-blocking deep-agent escalation"
```

---

### Final verification

- [ ] **Run the full backend suite**

Run: `python -m pytest -q`
Expected: all green (prior 134 + new tests).

- [ ] **Typecheck the frontend**

Run: `cd web; npx tsc --noEmit`
Expected: clean.

- [ ] **Manual smoke (optional, requires running servers + Max-plan CLI):**
  - Speak: "Jarvis, think hard about my finances and suggest where to cut spending."
  - Expect: an immediate spoken ack; voice stays responsive; the agent's answer is spoken a few seconds later at a pause.

- [ ] **Dispatch the final reviewer** (per subagent-driven-development), then proceed to **Plan B (chat surface)**.

---

## Notes for the implementer

- The agent tier runs **fully autonomous** (`--permission-mode bypassPermissions`): no permission prompts. Standing guardrails (don't print secrets; act within the request) live in the persona/context, not in code gates.
- `agent_stream` is built here but consumed by **Plan B** (chat). Voice uses the non-streaming `agent_text` via the `/deep` job.
- Keep the fast path (`tier=None`) byte-for-byte behavior-compatible — only additive changes.
