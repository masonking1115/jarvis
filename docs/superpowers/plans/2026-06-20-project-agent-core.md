# Project-Agent Core (CLI + resumable sessions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat's agent tier a warm, resumable, safely-autonomous coding agent on the free Max-plan CLI, so it keeps file knowledge across turns and verifies its own changes.

**Architecture:** Capture the Claude CLI `session_id` from its stream-json `system/init` event, persist it on `ChatState`, and pass `--resume <id>` on the next agent turn. Harden the agent's permissions (`acceptEdits` + allow/deny tool lists + `--max-turns`). Route code/project questions to the agent. No API billing — the agent keeps stripping `ANTHROPIC_API_KEY` to use the Max subscription.

**Tech Stack:** Python/FastAPI backend, Claude Code CLI (`claude -p`), SQLAlchemy/SQLite, pytest. Windows.

**Spec:** `docs/superpowers/specs/2026-06-20-project-agent-core-design.md`

## Global Constraints

- **Free Max plan:** the agent subprocess MUST strip `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from its env (as today) so the CLI uses the Max subscription. No API billing for the agent tier.
- **Run tests with the venv Python:** `& ".\.venv\Scripts\python.exe" -m pytest …` from the repo root (`python` may resolve to a Conda install without deps).
- **Agent cwd:** the JARVIS repo root (constant) — `--resume` requires the same cwd each turn.
- **Windows / PowerShell** for commands; use `git -C "C:\Users\mking\Downloads\JARVIS\jarvis" …`, no `&&`, no apostrophes in `-m` messages.
- **Backend restart** is required for backend changes (uvicorn started without `--reload`).

---

### Task 1: Spike — prove `--resume` and lock the flags

No production code. Confirms the CLI flags the rest of the plan depends on, and captures a real fixture. The CLI auth must be the Max plan (strip the key in the shell).

- [ ] **Step 1: Capture a session id (turn 1)**

Run (PowerShell, from repo root):
```powershell
$env:ANTHROPIC_API_KEY=''; $env:ANTHROPIC_AUTH_TOKEN=''
'x' | claude -p "Read backend/core/config.py and tell me the value of agent_model in one line." `
  --output-format stream-json --verbose --include-partial-messages `
  --permission-mode acceptEdits --allowedTools Read Bash Glob Grep --max-turns 8 --model sonnet `
  | Tee-Object -Variable out1 | Out-Null
$out1 -split "`n" | Select-String '"type":"system"' | Select-Object -First 1
```
Expected: a `system`/`init` JSON line containing `"session_id":"…"`. Copy that id. If `--max-turns` or `--allowedTools` is rejected, note which flags the installed CLI accepts (adjust Task 4 accordingly).

- [ ] **Step 2: Resume it (turn 2) and confirm continuity**

```powershell
$env:ANTHROPIC_API_KEY=''; $env:ANTHROPIC_AUTH_TOKEN=''
'x' | claude -p "Which file did you just read?" --resume "<SESSION_ID_FROM_STEP_1>" `
  --output-format stream-json --verbose --model sonnet
```
Expected: it answers `backend/core/config.py` **without** re-reading — proving resume retains file knowledge. Record that `--resume <id>` works.

- [ ] **Step 3: Verify the deny pattern syntax**

```powershell
$env:ANTHROPIC_API_KEY=''; $env:ANTHROPIC_AUTH_TOKEN=''
'x' | claude -p "Run: rm -rf ./nonexistent_test_dir (then say done)" `
  --permission-mode acceptEdits --allowedTools Bash --disallowedTools "Bash(rm *)" `
  --output-format stream-json --verbose --model sonnet
```
Expected: the `rm` is blocked (a permission denial event / refusal), confirming `--disallowedTools "Bash(rm *)"` syntax. If the pattern form differs, record the working form for Task 4.

- [ ] **Step 4: Save a parser fixture**

Save the first ~15 lines of `$out1` (must include the `system/init` line with `session_id`) to `tests/fixtures/agent_stream_sample.jsonl`. Commit:
```bash
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" add tests/fixtures/agent_stream_sample.jsonl
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" commit -m "test(fixture): capture agent stream-json with session_id for resume work"
```

> If any flag from Steps 1–3 is unsupported, adjust Task 4's command and note it in the commit message. Everything downstream uses only flags confirmed here.

---

### Task 2: Config — `agent_engine` and `agent_max_turns`

**Files:**
- Modify: `backend/core/config.py` (after the `agent_model` line, ~line 23)

**Interfaces:**
- Produces: `settings.agent_engine: str` (default `"cli"`), `settings.agent_max_turns: int` (default `30`)

- [ ] **Step 1: Add the settings**

After the `agent_model: str = "opus"` line in `backend/core/config.py`, add:
```python
    agent_engine: str = "cli"      # cli (Max-plan CLI) | sdk (paid API; future phase)
    agent_max_turns: int = 30      # cap the agent's autonomous loop per turn
```

- [ ] **Step 2: Verify import**

Run: `& ".\.venv\Scripts\python.exe" -c "from backend.core.config import settings; print(settings.agent_engine, settings.agent_max_turns)"`
Expected: `cli 30`

- [ ] **Step 3: Commit**

```bash
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" add backend/core/config.py
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" commit -m "feat(config): agent_engine + agent_max_turns"
```

---

### Task 3: Parser emits a `session` event

**Files:**
- Modify: `backend/core/stream_parse.py`
- Test: `tests/test_stream_parse.py` (append)

**Interfaces:**
- Produces: `parse_stream_lines` yields `{"type":"session","session_id": <str>}` when it sees a `system`/`init` event carrying a `session_id`. All existing events (`text`/`todos`/`tool`/`done`) unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_stream_parse.py`:
```python
def test_parse_emits_session_from_init():
    lines = [
        '{"type":"system","subtype":"init","session_id":"abc-123","model":"sonnet"}',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
        '{"type":"result","result":"hi"}',
    ]
    events = list(parse_stream_lines(iter(lines)))
    assert {"type": "session", "session_id": "abc-123"} in events
    assert events[-1]["type"] == "done"


def test_parse_ignores_non_init_system_events():
    # hook events also carry session_id but must NOT emit a session event
    lines = [
        '{"type":"system","subtype":"hook_started","session_id":"x"}',
        '{"type":"result","result":"ok"}',
    ]
    events = list(parse_stream_lines(iter(lines)))
    assert not any(e["type"] == "session" for e in events)
```

- [ ] **Step 2: Run to verify it fails**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_stream_parse.py -v`
Expected: `test_parse_emits_session_from_init` FAILS (no session event emitted).

- [ ] **Step 3: Implement**

In `backend/core/stream_parse.py`, inside the `for raw in lines:` loop, add a branch alongside the existing `elif etype == "result":` (place it before the `result` branch):
```python
        elif etype == "system" and ev.get("subtype") == "init" and ev.get("session_id"):
            yield {"type": "session", "session_id": ev["session_id"]}
```

- [ ] **Step 4: Run to verify it passes**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_stream_parse.py -v`
Expected: all pass (including the prior parser tests).

- [ ] **Step 5: Commit**

```bash
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" add backend/core/stream_parse.py tests/test_stream_parse.py
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" commit -m "feat(parse): emit session event from stream-json init"
```

---

### Task 4: Resumable, hardened agent in `ClaudeCliProvider`

**Files:**
- Modify: `backend/core/llm.py` (`agent_stream`, `agent_text`, + module-level tool lists)
- Test: `tests/test_agent_resume.py` (create)

**Interfaces:**
- Consumes: `settings.agent_max_turns`; `parse_stream_lines`.
- Produces: `ClaudeCliProvider.agent_stream(prompt, context="", model=None, session_id=None, timeout=300)` — adds `--resume <session_id>` when given; uses `--permission-mode acceptEdits`, `--allowedTools _AGENT_ALLOWED`, `--disallowedTools _AGENT_DISALLOWED`, `--max-turns`. `agent_text(...)` gets the same hardening (no resume). Module constants `_AGENT_ALLOWED: list[str]`, `_AGENT_DISALLOWED: list[str]`.

> Permission backstop is the per-invocation `--disallowedTools` (NOT a project `.claude/settings.json` — that would also constrain interactive Claude Code sessions in this repo, e.g. blocking `git push` for the developer).

- [ ] **Step 1: Write the failing test**

Create `tests/test_agent_resume.py`:
```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_agent_resume.py -v`
Expected: FAIL — `agent_stream` has no `session_id` param / lacks the new flags.

- [ ] **Step 3: Implement**

In `backend/core/llm.py`, add module-level constants near the top (after the imports):
```python
# Tools the autonomous agent may use, and dangerous patterns it may never run.
# Per-invocation flags (not a project settings.json) so interactive Claude Code
# sessions in this repo stay unrestricted.
_AGENT_ALLOWED = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"]
_AGENT_DISALLOWED = ["Bash(rm *)", "Bash(git push *)", "Bash(sudo *)", "Bash(curl *)",
                     "Bash(dd *)", "Bash(mkfs *)", "Bash(shutdown *)"]
```

Replace `agent_text`'s command block (the `cmd = [...]` and the `if context:` insert) with:
```python
        cmd = [self.path, "-p", prompt, "--output-format", "text",
               "--permission-mode", "acceptEdits",
               "--max-turns", str(settings.agent_max_turns),
               "--model", (model or self.model),
               "--allowedTools", *_AGENT_ALLOWED,
               "--disallowedTools", *_AGENT_DISALLOWED]
        if context:
            cmd += ["--append-system-prompt", context]
```

Change `agent_stream`'s signature to add `session_id`:
```python
    def agent_stream(self, prompt: str, context: str = "", model: str | None = None,
                     session_id: str | None = None, timeout: int = 300):
```
and replace its command block (the `cmd = [...]` and the `if context:` insert) with:
```python
        cmd = [self.path, "-p", prompt,
               "--output-format", "stream-json", "--verbose", "--include-partial-messages",
               "--permission-mode", "acceptEdits",
               "--max-turns", str(settings.agent_max_turns),
               "--model", (model or self.model),
               "--allowedTools", *_AGENT_ALLOWED,
               "--disallowedTools", *_AGENT_DISALLOWED]
        if context:
            cmd += ["--append-system-prompt", context]
        if session_id:
            cmd += ["--resume", session_id]
```

(If Task 1 found a flag unsupported, drop/adjust it here and in the test.)

- [ ] **Step 4: Run to verify it passes**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_agent_resume.py -v`
Expected: PASS.

- [ ] **Step 5: Full suite (no regressions)**

Run: `& ".\.venv\Scripts\python.exe" -m pytest -q`
Expected: all pass (the older `test_agent_provider.py` still green — its assertions don't pin the permission mode; if one asserts `bypassPermissions`, update it to `acceptEdits`).

- [ ] **Step 6: Commit**

```bash
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" add backend/core/llm.py tests/test_agent_resume.py
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" commit -m "feat(agent): resumable sessions + acceptEdits/allow/deny + max-turns"
```

---

### Task 5: Persist the session id on `ChatState`

**Files:**
- Modify: `backend/modules/chat/models.py`
- Modify: `backend/core/db.py` (additive migration)
- Test: `tests/test_chat_models.py` (append)

**Interfaces:**
- Produces: `ChatState.agent_session_id: str` (default `""`).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_chat_models.py`:
```python
def test_chat_state_has_agent_session_id(db):
    s = get_state(db)
    assert s.agent_session_id == ""
    s.agent_session_id = "sid-42"
    db.commit()
    assert get_state(db).agent_session_id == "sid-42"
```

- [ ] **Step 2: Run to verify it fails**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_chat_models.py -v`
Expected: FAIL — `ChatState` has no `agent_session_id`.

- [ ] **Step 3: Implement the column**

In `backend/modules/chat/models.py`, add to `ChatState` (after `compaction_summary`):
```python
    agent_session_id: Mapped[str] = mapped_column(String(64), default="")
```

In `backend/core/db.py`, inside `_apply_lightweight_migrations`'s `additions` dict, add:
```python
        "chat_state": [
            ("agent_session_id", "VARCHAR(64) DEFAULT ''"),
        ],
```

- [ ] **Step 4: Run to verify it passes**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_chat_models.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" add backend/modules/chat/models.py backend/core/db.py tests/test_chat_models.py
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" commit -m "feat(chat): persist agent_session_id on ChatState"
```

---

### Task 6: Wire resume into chat `/stream`

**Files:**
- Modify: `backend/modules/chat/router.py` (`_agent_stream` + the agent branch in `stream`)
- Test: `tests/test_chat_stream_endpoint.py` (append)

**Interfaces:**
- Consumes: `ClaudeCliProvider.agent_stream(..., session_id=…)`; `ChatState.agent_session_id`.
- Produces: the agent branch passes the stored session id, persists the new one from the `session` event, and does NOT forward `session` events to the client.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_chat_stream_endpoint.py`:
```python
def test_stream_agent_persists_session_and_hides_it(ctx, monkeypatch):
    client, TestingSession = ctx
    monkeypatch.setattr(cr.service, "plan",
                        lambda db, msgs, skill=None, tier=None, extra_context=None: {"kind": "escalate", "reason": "x"})
    seen = {}
    def fake_stream(prompt, context="", session_id=None):
        seen["session_id"] = session_id
        yield {"type": "session", "session_id": "sid-77"}
        yield {"type": "text", "text": "working"}
        yield {"type": "done", "text": "working"}
    monkeypatch.setattr(cr, "_agent_stream", fake_stream)

    r = client.post("/api/chat/stream", json={"text": "fix the bug", "tier": "agent"})
    evs = _events(r.text)
    assert not any(e["type"] == "session" for e in evs)     # session not leaked to client
    assert evs[-1]["type"] == "done"
    # persisted for next turn
    from backend.modules.chat.models import get_state
    assert get_state(TestingSession()).agent_session_id == "sid-77"
```

> Note: the `ctx` fixture currently returns `(client, _)`. Update its `return` to `return TestClient(app), TestingSession` so the test can open a session (it already builds `TestingSession`).

- [ ] **Step 2: Run to verify it fails**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_chat_stream_endpoint.py -v`
Expected: FAIL — session not persisted / `_agent_stream` has no `session_id` param.

- [ ] **Step 3: Implement**

In `backend/modules/chat/router.py`, update the `_agent_stream` indirection:
```python
def _agent_stream(prompt: str, context: str = "", session_id: str | None = None, **kw):
    """Indirection so tests can monkeypatch the CLI streaming call."""
    yield from ClaudeCliProvider().agent_stream(prompt, context=context, session_id=session_id)
```

In the `stream` generator's agent branch, replace the loop:
```python
            if kind == "escalate" or tier == "agent":
                prompt = "\n\n".join(f"{m['role']}: {m['content']}" for m in msgs)
                context = f"{load_persona()}\n\n{_build_context(db)}"
                for ev in _agent_stream(prompt, context=context, session_id=state.agent_session_id or None):
                    if ev["type"] == "session":
                        state.agent_session_id = ev["session_id"]
                        db.commit()
                        continue                      # internal — don't send to the client
                    if ev["type"] == "text":
                        assistant_text += ev["text"]
                    elif ev["type"] == "todos":
                        todos = ev["todos"]
                    yield _sse(ev)
```
(`state = get_state(db)` is already fetched earlier in the generator.)

- [ ] **Step 4: Run to verify it passes**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_chat_stream_endpoint.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" add backend/modules/chat/router.py tests/test_chat_stream_endpoint.py
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" commit -m "feat(chat): resume agent session across turns via ChatState"
```

---

### Task 7: Route code/project questions to the agent

**Files:**
- Modify: `backend/modules/agent/service.py` (`_PLAN_INSTRUCTION`)
- Test: `tests/test_tier_dispatch.py` (append)

**Interfaces:**
- Consumes: existing `plan()` + `escalate` kind. No new shape.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_tier_dispatch.py`:
```python
def test_plan_instruction_mentions_code_escalation():
    # The router prompt must tell the model to escalate code/project questions.
    assert "code" in svc._PLAN_INSTRUCTION.lower()
    assert "escalate" in svc._PLAN_INSTRUCTION.lower()
```

- [ ] **Step 2: Run to verify it fails**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_tier_dispatch.py::test_plan_instruction_mentions_code_escalation -v`
Expected: FAIL if the current escalate clause doesn't mention code (it currently says "reading files or the user's own data"). If it already passes, still do Step 3 to sharpen the wording, then keep the test.

- [ ] **Step 3: Implement**

In `backend/modules/agent/service.py`, change the escalate clause inside `_PLAN_INSTRUCTION` to:
```python
    '- Escalate: {"kind":"escalate","reason":"<why>"} — use when the request needs '
    "multiple steps, reading files or the user's own data, web research plus synthesis, "
    "deep analysis a single reply can't do well, OR anything about the code, repository, "
    "files, building, running, testing, or debugging this project (read the actual files "
    "with the agent — never guess about the codebase).\n"
```

- [ ] **Step 4: Run to verify it passes**

Run: `& ".\.venv\Scripts\python.exe" -m pytest tests/test_tier_dispatch.py -v`
Expected: PASS (all dispatch tests).

- [ ] **Step 5: Commit**

```bash
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" add backend/modules/agent/service.py tests/test_tier_dispatch.py
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" commit -m "feat(agent): escalate code/project questions to the agent tier"
```

---

### Task 8: Verify-after-changes instruction

**Files:**
- Modify: `backend/jarvis_profile.md` (persona — loaded into the agent's appended context)

**Interfaces:** none (text only).

- [ ] **Step 1: Add the instruction**

In `backend/jarvis_profile.md`, under the `## Memory` section (or add a `## Building` section before `## Guardrails`), add:
```markdown
## Building
- When you edit code, verify it: run the project's tests/typecheck/build (e.g. `python -m pytest -q`, `npx tsc --noEmit`) and report pass/fail briefly. If something fails, fix it and re-verify before saying it's done.
- Prefer the smallest change that works; match the surrounding code's style.
```

- [ ] **Step 2: Confirm it loads (no code)**

Run: `& ".\.venv\Scripts\python.exe" -c "from backend.modules.chat.router import load_persona; print('Building' in load_persona())"`
Expected: `True`

- [ ] **Step 3: Commit**

```bash
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" add backend/jarvis_profile.md
git -C "C:\Users\mking\Downloads\JARVIS\jarvis" commit -m "tune(persona): verify-after-changes building instruction"
```

---

### Final verification

- [ ] **Full backend suite**

Run: `& ".\.venv\Scripts\python.exe" -m pytest -q`
Expected: all green (prior + new tests).

- [ ] **Restart backend**

Free port 8000 and relaunch from the repo root:
```powershell
$c = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($c) { $c.OwningProcess | Select-Object -Unique | ForEach-Object { taskkill /PID $_ /T /F } }
Set-Location "C:\Users\mking\Downloads\JARVIS\jarvis"; & ".\.venv\Scripts\python.exe" -m uvicorn backend.main:app --port 8000
```
(Run the uvicorn line in the background.)

- [ ] **Manual e2e (continuity):** in the orb chat, `/model agent`, then: "Read backend/core/config.py and tell me the default voice_model." → next message (no re-reading): "What file did you just read?" → it answers `backend/core/config.py`, proving resume. Confirm a dangerous command (e.g. asking it to `rm -rf`) is refused.

- [ ] **Dispatch the final reviewer** (per subagent-driven-development), then proceed to Phase 2 (project binding + per-project memory + auto-compaction) as its own spec.

---

## Notes for the implementer

- The agent tier stays on the **free Max plan** — never add the API key to the agent subprocess; keep stripping `ANTHROPIC_API_KEY`.
- Only flags **confirmed in Task 1** may be used. If `--max-turns`/`--disallowedTools` pattern syntax differs, adjust Task 4 and its test together.
- Resume is best-effort: if a resumed run errors (stale session), the agent branch should let the next turn start fresh. The current `agent_stream` already emits a graceful `text`+`done` on failure; if you see repeated resume failures, clear `state.agent_session_id` in the except path of the agent branch (optional hardening).
- Keep the fast/smart tiers and the CLI fallback untouched.
