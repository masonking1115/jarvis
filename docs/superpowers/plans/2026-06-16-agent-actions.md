# JARVIS Action Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Voice commands can trigger actions (web search, weather, navigate, open flyover) with a spoken ack → result flow, via an extensible registry. Spec: `docs/superpowers/specs/2026-06-16-agent-actions-design.md`.

**Tech:** FastAPI agent module (plan/run + registry), Claude CLI for web search, existing OpenWeather for weather; VoiceProvider orchestrates ack→execute→result; FlyoverProvider opens via a window event.

---

## File Structure
**Backend (create):** `backend/modules/agent/{__init__,registry,service,router}.py`; **(modify):** `backend/core/config.py`, `backend/core/llm.py` (ClaudeCliProvider.web_answer). **Test:** `tests/test_agent.py`.
**Frontend (modify):** `web/lib/api.ts`, `web/components/voice/VoiceProvider.tsx`, `web/components/flyover/FlyoverProvider.tsx`.

---

## Task 1: Backend agent module + tests

- [ ] **Step 1: config** — `backend/core/config.py`: add `agent_search_model: str = "sonnet"`.

- [ ] **Step 2: CLI web answer** — in `backend/core/llm.py`, add to `ClaudeCliProvider`:

```python
    def web_answer(self, query: str, model: str | None = None) -> str:
        if not self.available:
            raise RuntimeError("claude CLI not found on PATH")
        import os, subprocess, tempfile
        env = {k: v for k, v in os.environ.items()
               if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
        prompt = ("Search the web and answer for spoken delivery — 2-3 sentences, "
                  "plain text, no markdown, no lists:\n\n" + query)
        cmd = [self.path, "-p", prompt, "--allowedTools", "WebSearch", "WebFetch",
               "--output-format", "text", "--model", (model or self.model)]
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", env=env, cwd=tempfile.gettempdir(), timeout=120)
        if proc.returncode != 0:
            raise RuntimeError(f"claude web search failed ({proc.returncode}): {proc.stderr[:200]}")
        return proc.stdout.strip().replace("�", "-")
```

- [ ] **Step 3: registry** — `backend/modules/agent/registry.py`:

```python
TOOLS = [
    {"name": "web_search", "where": "backend",
     "desc": "Search the web for current info, facts, news, prices, etc.",
     "args": "query (string): what to search for"},
    {"name": "weather", "where": "backend",
     "desc": "Current weather conditions for a place.",
     "args": "location (string, optional): city/address; omit for the user's saved location"},
    {"name": "navigate", "where": "frontend",
     "desc": "Open a section of the JARVIS console.",
     "args": "target (string): one of dashboard, finance, spending, email, fitness, workouts, projects, trading, agents, notes, settings, goals, schedule, tax"},
    {"name": "open_flyover", "where": "frontend",
     "desc": "Open the full-screen photoreal map/flyover of the user's address.",
     "args": "(none)"},
]
NAMES = {t["name"] for t in TOOLS}

def render() -> str:
    lines = ["Available actions:"]
    for t in TOOLS:
        lines.append(f'- {t["name"]}({t["args"]}) — {t["desc"]}')
    return "\n".join(lines)
```

- [ ] **Step 4: service** — `backend/modules/agent/service.py`:

```python
"""Agent action layer: plan (reply vs action) + run (backend tools)."""
from __future__ import annotations

import json
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.llm import get_provider, ClaudeCliProvider
from backend.modules.chat.router import load_persona
from backend.modules.flyover import geocode as fly_geocode, weather as fly_weather, service as fly_service
from . import registry

_PLAN_INSTRUCTION = (
    "Decide if the user's latest message needs an ACTION or just a REPLY.\n"
    f"{{tools}}\n\n"
    "Respond with ONLY a JSON object, no prose, no code fences:\n"
    '- Plain answer: {"kind":"reply","text":"<concise spoken answer>"}\n'
    '- Action: {"kind":"action","tool":"<one of the action names>","args":{...},'
    '"ack":"<short spoken acknowledgement, e.g. \'Yes sir, performing the weather search now.\'>"}\n'
    "Use an action only when it clearly matches one above; otherwise reply."
)


def _parse(raw: str) -> dict:
    s = raw.strip()
    if "```" in s:                      # strip code fences
        s = s.split("```")[1] if s.count("```") >= 2 else s.replace("```", "")
        s = s.lstrip("json").strip()
    i, j = s.find("{"), s.rfind("}")
    if i != -1 and j != -1:
        try:
            obj = json.loads(s[i:j + 1])
            if isinstance(obj, dict) and obj.get("kind") in ("reply", "action"):
                return obj
        except Exception:  # noqa: BLE001
            pass
    return {"kind": "reply", "text": raw.strip() or "I'm not sure, sir."}


def plan(db: Session, messages: list[dict]) -> dict:
    provider = get_provider()
    system = (load_persona() + "\n\n"
              + _PLAN_INSTRUCTION.replace("{tools}", registry.render()))
    raw = provider.chat(system=system, messages=messages, model=settings.voice_model)
    out = _parse(raw)
    if out.get("kind") == "action" and out.get("tool") not in registry.NAMES:
        return {"kind": "reply", "text": out.get("ack") or "I can't do that yet, sir."}
    return out


def _weather_line(db: Session, location: str | None) -> str:
    if location:
        hit = fly_geocode.geocode(location)
        if not hit:
            return f"I couldn't find {location}, sir."
        lat, lng, label = hit["lat"], hit["lng"], hit["address"]
    else:
        s = fly_service.get_or_create(db) if hasattr(fly_service, "get_or_create") else None
        from backend.modules.flyover.models import get_or_create
        row = get_or_create(db)
        lat, lng, label = row.lat, row.lng, (row.address or "your location")
        if lat is None:
            lat, lng, label = settings.flyover_default_lat, settings.flyover_default_lng, settings.flyover_default_address
    w = fly_weather.current(lat, lng)
    temp = round(w.get("temp")) if w.get("temp") is not None else "?"
    desc = w.get("description") or w.get("main") or "clear"
    return f"It's {temp} degrees, {desc}, in {label}, sir."


def run(db: Session, tool: str, args: dict) -> dict:
    args = args or {}
    try:
        if tool == "weather":
            return {"text": _weather_line(db, args.get("location"))}
        if tool == "web_search":
            provider = get_provider()
            q = args.get("query") or ""
            if isinstance(provider, ClaudeCliProvider) and provider.available:
                return {"text": provider.web_answer(q, model=settings.agent_search_model)}
            return {"text": provider.chat(system=load_persona(), messages=[{"role": "user", "content": q}], model=settings.voice_model)}
        return {"text": "I can't do that yet, sir."}
    except Exception:  # noqa: BLE001 — never leak keys / stack to the client
        return {"text": "I ran into a problem with that, sir."}
```

- [ ] **Step 5: router + init** — `backend/modules/agent/router.py`:

```python
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from . import service, registry

router = APIRouter()


class Msg(BaseModel):
    role: str
    content: str


class PlanIn(BaseModel):
    messages: list[Msg]


@router.get("/tools")
def tools():
    return {"tools": registry.TOOLS}


@router.post("/plan")
def plan(body: PlanIn, db: Session = Depends(get_db)):
    return service.plan(db, [{"role": m.role, "content": m.content} for m in body.messages])


class RunIn(BaseModel):
    tool: str
    args: dict = {}


@router.post("/run")
def run(body: RunIn, db: Session = Depends(get_db)):
    return service.run(db, body.tool, body.args)
```
`__init__.py`: `from .router import router` + `__all__ = ["router"]`.

- [ ] **Step 6: tests** — `tests/test_agent.py`:

```python
import importlib
from backend.modules.agent import service, registry
from backend.core.config import settings as app_settings
import backend.core.llm as llm

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
    assert "web_search" in r and "navigate" in r and "open_flyover" in r


def test_plan_parses_action(monkeypatch):
    class P:
        name = "x"
        def chat(self, system, messages, model=None):
            return '{"kind":"action","tool":"weather","args":{"location":"Reno"},"ack":"Yes sir."}'
    monkeypatch.setattr(service, "get_provider", lambda o=None: P())
    out = service.plan(FakeDB(), [{"role": "user", "content": "weather in reno"}])
    assert out["kind"] == "action" and out["tool"] == "weather" and out["args"]["location"] == "Reno"


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
```

- [ ] **Step 7: run tests** — `pytest tests/test_agent.py -q` → PASS. Then full suite `pytest -q`.

- [ ] **Step 8: verify mount** — restart backend; `curl /api/agent/tools` lists 4 tools; `curl -X POST /api/agent/run -d '{"tool":"weather","args":{}}'` → spoken weather line (uses saved/default location).

- [ ] **Step 9: commit** — `git add backend/modules/agent backend/core/config.py backend/core/llm.py tests/test_agent.py && git commit -m "feat(agent): action layer (plan/run + registry, web search, weather)"`

---

## Task 2: Frontend wiring

- [ ] **Step 1: api.ts** — add:

```typescript
export type AgentPlan =
  | { kind: "reply"; text: string }
  | { kind: "action"; tool: string; args: Record<string, any>; ack: string };
export const agent = {
  plan: (messages: { role: string; content: string }[]) =>
    api.post<AgentPlan>("/api/agent/plan", { messages }),
  run: (tool: string, args: Record<string, any>) =>
    api.post<{ text: string }>("/api/agent/run", { tool, args }),
};
```

- [ ] **Step 2: FlyoverProvider window-event open** — add an effect:

```tsx
useEffect(() => {
  const open = () => setOpen(true);
  window.addEventListener("jarvis:flyover", open);
  return () => window.removeEventListener("jarvis:flyover", open);
}, []);
```

- [ ] **Step 3: VoiceProvider — route through the agent.** Add `useRouter`. Replace the `/api/chat` call in `handle()` with the agent flow:

```tsx
const ROUTES = ["dashboard","finance","spending","email","fitness","workouts","projects","trading","agents","notes","settings","goals","schedule","tax"];

function runFrontend(tool: string, args: any): boolean {
  if (tool === "navigate" && ROUTES.includes(args?.target)) { router.push("/" + args.target); return true; }
  if (tool === "open_flyover") { window.dispatchEvent(new CustomEvent("jarvis:flyover")); return true; }
  return false;
}

async function handle(text: string) {
  if (!text) { set("idle"); return; }
  clearIdle(); setLastHeard(text); set("thinking");
  msgsRef.current = [...msgsRef.current, { role: "user" as const, content: text }].slice(-8);
  let plan: any;
  try { plan = await agent.plan(msgsRef.current); }
  catch { plan = { kind: "reply", text: "Sorry, I couldn't reach the server." }; }

  if (plan.kind === "action") {
    const ack = plan.ack || "On it, sir.";
    msgsRef.current = [...msgsRef.current, { role: "assistant" as const, content: ack }].slice(-8);
    setLastSpoken(ack);
    if (runFrontend(plan.tool, plan.args)) { await speak(ack); return; }      // navigation: ack only
    // backend tool: speak ack while the action runs, then speak the result
    const runP = agent.run(plan.tool, plan.args).then(r => r.text).catch(() => "I ran into a problem, sir.");
    await speak(ack);
    const result = await runP;
    setLastSpoken(result);
    await speak(result);
    return;
  }
  const reply = plan.text || "…";
  msgsRef.current = [...msgsRef.current, { role: "assistant" as const, content: reply }].slice(-8);
  setLastSpoken(reply); await speak(reply);
}
```
> Note: `speak()` currently transitions to conversation mode in its `done` handler. For the ack-then-result case, make `speak()` accept an optional `{final}` flag so only the *final* utterance re-enters conversation mode (the ack should not). Add `async function speak(text, opts?: {final?: boolean})` and gate the `beginCapture()` in `done` on `opts?.final !== false`; call the ack as `speak(ack, {final:false})` and results/replies as `speak(text)` (final default true).

- [ ] **Step 4: typecheck + build** — `npx tsc --noEmit && npm run build` → clean.

- [ ] **Step 5: commit** — `git add web/lib/api.ts web/components/voice/VoiceProvider.tsx web/components/flyover/FlyoverProvider.tsx && git commit -m "feat(agent): voice routes through action layer (ack -> execute -> result, navigation)"`

---

## Task 3: Manual verification (Chrome/Edge, mic + Azure)
- [ ] Restart backend + ensure dev server clean.
- [ ] `curl /api/agent/run -d '{"tool":"weather","args":{"location":"Atherton"}}'` → spoken weather line.
- [ ] Voice: "Hey JARVIS, what's the weather?" → hears ack, then the weather, spoken.
- [ ] Voice: "Hey JARVIS, open my finances" → navigates to /finance after the ack.
- [ ] Voice: "Hey JARVIS, open the map" → flyover opens.
- [ ] Voice: "Hey JARVIS, search the web for the latest on <topic>" → ack, then a spoken summary (verify the CLI WebSearch works headless; if not, adjust `--allowedTools`/`--permission-mode` and note it).
- [ ] Commit any fixes; push.

## Notes
- **CLI web tools risk:** if `--allowedTools WebSearch WebFetch` doesn't permit tools headlessly, try `--permission-mode acceptEdits` is wrong (that's edits) — use `--allowedTools` (allowlist) and, if still blocked, `--dangerously-skip-permissions` only for the temp-cwd search call. Decide at verification.
- **No keys in output:** weather/web errors return a generic spoken apology.
