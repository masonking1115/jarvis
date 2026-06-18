# JARVIS Claude-Code-style Chat Surface — Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persistent, streaming in-app chat that emulates Claude Code — live token streaming, a real todo panel and tool chips (from the agent tier's `agent_stream`), and the slash commands `/model`, `/compact`, `/brainstorm`, `/help` — styled to the JARVIS console.

**Architecture:** One persistent thread (`ChatTurn`) + a one-row `ChatState` (sticky tier, mode, compaction summary). New chat endpoints: `GET /thread`, SSE `POST /stream`, `POST /compact`, `POST /model`, `POST /mode`. `/stream` routes through the Plan A dispatcher (`agent/service.plan(..., tier=...)`); the agent tier forwards `ClaudeCliProvider.agent_stream` events as SSE. The page renders streamed text, a todo panel, tool chips, a tier badge, and a slash menu.

**Tech Stack:** FastAPI `StreamingResponse` (SSE), SQLAlchemy, Next.js/React, pytest.

**Spec:** `docs/superpowers/specs/2026-06-17-jarvis-tiered-brain-chat-design.md` (Components 3–6)

**Depends on:** Plan A (`agent_stream`, `plan(tier=...)`, `/api/agent/deep`) — already implemented.

---

### Task 1: Chat persistence models

**Files:**
- Create: `backend/modules/chat/models.py`
- Modify: `backend/core/db.py:51-53` (register models in `init_db`)
- Test: `tests/test_chat_models.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_chat_models.py
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base
from backend.modules.chat.models import ChatTurn, ChatState, get_state


@pytest.fixture
def db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    yield sessionmaker(bind=eng)()


def test_get_state_is_singleton_with_defaults(db):
    s = get_state(db)
    assert s.id == 1 and s.tier == "fast" and s.mode == "" and s.compaction_summary == ""
    s2 = get_state(db)
    assert s2.id == 1  # same row, not a second one


def test_chat_turns_persist_and_order(db):
    db.add(ChatTurn(role="user", content="hi"))
    db.add(ChatTurn(role="assistant", content="hello", tier="fast"))
    db.commit()
    rows = db.query(ChatTurn).order_by(ChatTurn.id.asc()).all()
    assert [(r.role, r.content) for r in rows] == [("user", "hi"), ("assistant", "hello")]
    assert rows[1].tier == "fast"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_chat_models.py -v`
Expected: FAIL — `backend.modules.chat.models` has no `ChatTurn`/`ChatState`/`get_state`.

- [ ] **Step 3: Implement the models**

```python
# backend/modules/chat/models.py
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class ChatTurn(Base):
    """One message in the single persistent chat thread."""
    __tablename__ = "chat_turns"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role: Mapped[str] = mapped_column(String(16))            # user | assistant
    content: Mapped[str] = mapped_column(Text)
    tier: Mapped[str | None] = mapped_column(String(16), default=None)  # brain that produced an assistant turn
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChatState(Base):
    """Single-row chat state: sticky tier, mode, and the running compaction summary."""
    __tablename__ = "chat_state"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tier: Mapped[str] = mapped_column(String(16), default="fast")     # fast | smart | agent
    mode: Mapped[str] = mapped_column(String(16), default="")         # "" | brainstorm
    compaction_summary: Mapped[str] = mapped_column(Text, default="")


def get_state(db) -> "ChatState":
    row = db.get(ChatState, 1)
    if row is None:
        row = ChatState(id=1)
        db.add(row); db.commit(); db.refresh(row)
    return row
```

- [ ] **Step 4: Register the models in `init_db`**

In `backend/core/db.py`, in `init_db`, after the skills import line add:

```python
    from backend.modules.chat import models as _chat_models  # noqa: F401
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_chat_models.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/modules/chat/models.py backend/core/db.py tests/test_chat_models.py
git commit -m "feat(chat): persistent ChatTurn + ChatState models"
```

---

### Task 2: Thread store helpers

**Files:**
- Create: `backend/modules/chat/store.py`
- Test: `tests/test_chat_store.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_chat_store.py
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base
from backend.modules.chat import store
from backend.modules.chat.models import ChatTurn, get_state


@pytest.fixture
def db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    yield sessionmaker(bind=eng)()


def test_add_and_thread_messages(db):
    store.add_turn(db, "user", "hello")
    store.add_turn(db, "assistant", "hi sir", tier="fast")
    msgs = store.thread_messages(db)
    assert msgs == [{"role": "user", "content": "hello"},
                    {"role": "assistant", "content": "hi sir"}]


def test_compact_replaces_turns_with_summary(db):
    store.add_turn(db, "user", "a")
    store.add_turn(db, "assistant", "b")
    store.compact(db, "we discussed a and b")
    assert db.query(ChatTurn).count() == 0
    assert get_state(db).compaction_summary == "we discussed a and b"
    msgs = store.thread_messages(db)
    assert msgs[0]["role"] == "assistant" and "we discussed a and b" in msgs[0]["content"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_chat_store.py -v`
Expected: FAIL — `backend.modules.chat.store` does not exist.

- [ ] **Step 3: Implement**

```python
# backend/modules/chat/store.py
"""Helpers for the single persistent chat thread."""
from .models import ChatTurn, get_state


def add_turn(db, role: str, content: str, tier: str | None = None) -> ChatTurn:
    t = ChatTurn(role=role, content=content, tier=tier)
    db.add(t); db.commit(); db.refresh(t)
    return t


def load_turns(db) -> list[ChatTurn]:
    return db.query(ChatTurn).order_by(ChatTurn.created_at.asc(), ChatTurn.id.asc()).all()


def thread_messages(db) -> list[dict]:
    """Messages for the brain: a leading summary note (if compacted) + the turns."""
    state = get_state(db)
    msgs: list[dict] = []
    if state.compaction_summary:
        msgs.append({"role": "assistant",
                     "content": f"(summary of earlier conversation) {state.compaction_summary}"})
    for t in load_turns(db):
        msgs.append({"role": t.role, "content": t.content})
    return msgs


def compact(db, summary: str) -> None:
    state = get_state(db)
    state.compaction_summary = summary
    db.query(ChatTurn).delete()
    db.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_chat_store.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/modules/chat/store.py tests/test_chat_store.py
git commit -m "feat(chat): thread store helpers (add/load/thread_messages/compact)"
```

---

### Task 3: Non-streaming chat endpoints (thread, model, mode, compact)

**Files:**
- Modify: `backend/modules/chat/router.py` (add routes; keep existing `chat`/`briefing`)
- Test: `tests/test_chat_endpoints.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_chat_endpoints.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base, get_db
import backend.modules.chat.router as cr


@pytest.fixture
def client():
    from sqlalchemy.pool import StaticPool
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)  # one shared in-memory connection across threads
    Base.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng)

    def _override():
        db = TestingSession()
        try: yield db
        finally: db.close()

    app = FastAPI()
    app.include_router(cr.router, prefix="/api/chat")
    app.dependency_overrides[get_db] = _override
    return TestClient(app)


def test_thread_empty_then_model_then_mode(client):
    r = client.get("/api/chat/thread").json()
    assert r == {"messages": [], "tier": "fast", "mode": ""}

    assert client.post("/api/chat/model", json={"tier": "agent"}).json()["tier"] == "agent"
    assert client.post("/api/chat/mode", json={"mode": "brainstorm"}).json()["mode"] == "brainstorm"

    r = client.get("/api/chat/thread").json()
    assert r["tier"] == "agent" and r["mode"] == "brainstorm"


def test_model_rejects_unknown_tier(client):
    assert client.post("/api/chat/model", json={"tier": "wizard"}).status_code == 422


def test_compact_summarizes_and_clears(client, monkeypatch):
    # seed a couple of turns through the store, via a direct session is simplest:
    from backend.modules.chat import store
    # reach the overridden session by calling the app's dependency once:
    gen = client.app.dependency_overrides[get_db]()
    db = next(gen)
    store.add_turn(db, "user", "hello")
    store.add_turn(db, "assistant", "hi")

    monkeypatch.setattr(cr, "_summarize", lambda msgs: "a short summary")
    out = client.post("/api/chat/compact", json={}).json()
    assert out["summary"] == "a short summary"
    assert client.get("/api/chat/thread").json()["messages"][0]["content"].startswith(
        "(summary of earlier conversation)")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_chat_endpoints.py -v`
Expected: FAIL — routes/`_summarize` not defined.

- [ ] **Step 3: Implement**

Add to `backend/modules/chat/router.py` (new imports at top, then the routes). Add imports:

```python
from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import Literal
from backend.modules.chat import store
from backend.modules.chat.models import get_state
```

Add request models and routes (after the existing `chat`/`briefing`):

```python
class ModelIn(BaseModel):
    tier: Literal["fast", "smart", "agent"]


class ModeIn(BaseModel):
    mode: Literal["", "brainstorm"]


def _summarize(messages: list[dict]) -> str:
    """Summarize the thread with the fast provider (indirection for tests)."""
    provider = get_provider()
    sys = ("Summarize this conversation so it can continue with full context: open "
           "threads, decisions, the user's surfaced goals/preferences, and any pending todos. "
           "Be concise; no preamble.")
    return provider.chat(system=sys, messages=messages, model=settings.voice_model).strip()


@router.get("/thread")
def thread(db: Session = Depends(get_db)):
    state = get_state(db)
    turns = store.load_turns(db)
    return {
        "messages": [{"role": t.role, "content": t.content, "tier": t.tier} for t in turns],
        "tier": state.tier,
        "mode": state.mode,
    }


@router.post("/model")
def set_model(body: ModelIn, db: Session = Depends(get_db)):
    state = get_state(db)
    state.tier = body.tier
    db.commit()
    return {"tier": state.tier}


@router.post("/mode")
def set_mode(body: ModeIn, db: Session = Depends(get_db)):
    state = get_state(db)
    state.mode = body.mode
    db.commit()
    return {"mode": state.mode}


@router.post("/compact")
def compact(db: Session = Depends(get_db)):
    summary = _summarize(store.thread_messages(db)) or "(nothing to summarize yet)"
    store.compact(db, summary)
    return {"summary": summary}
```

> `get_provider` and `settings` are already imported at the top of `chat/router.py`. The `Literal` import on `ModelIn`/`ModeIn` makes an unknown value return 422 automatically.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_chat_endpoints.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/modules/chat/router.py tests/test_chat_endpoints.py
git commit -m "feat(chat): thread/model/mode/compact endpoints"
```

---

### Task 4: SSE streaming endpoint

**Files:**
- Modify: `backend/modules/chat/router.py` (add `/stream`)
- Test: `tests/test_chat_stream_endpoint.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_chat_stream_endpoint.py
import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base, get_db
import backend.modules.chat.router as cr


@pytest.fixture
def ctx():
    from sqlalchemy.pool import StaticPool
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)  # one shared in-memory connection across threads
    Base.metadata.create_all(eng)
    TestingSession = sessionmaker(bind=eng)
    # /stream opens its OWN session via cr.SessionLocal — point it at the test engine.
    cr.SessionLocal = TestingSession

    def _override():
        db = TestingSession()
        try: yield db
        finally: db.close()

    app = FastAPI()
    app.include_router(cr.router, prefix="/api/chat")
    app.dependency_overrides[get_db] = _override
    return TestClient(app), TestingSession


def _events(resp_text):
    return [json.loads(line[5:]) for line in resp_text.splitlines()
            if line.startswith("data:")]


def test_stream_reply_persists_turn(ctx, monkeypatch):
    client, _ = ctx
    monkeypatch.setattr(cr.service, "plan",
                        lambda db, msgs, skill=None, tier=None: {"kind": "reply", "text": "hello sir"})
    r = client.post("/api/chat/stream", json={"text": "hi"})
    evs = _events(r.text)
    assert {"type": "text", "text": "hello sir"} in evs
    assert evs[-1]["type"] == "done"
    # user + assistant persisted
    assert client.get("/api/chat/thread").json()["messages"] == [
        {"role": "user", "content": "hi", "tier": None},
        {"role": "assistant", "content": "hello sir", "tier": "fast"},
    ]


def test_stream_agent_tier_forwards_agent_events(ctx, monkeypatch):
    client, _ = ctx
    monkeypatch.setattr(cr.service, "plan",
                        lambda db, msgs, skill=None, tier=None: {"kind": "escalate", "reason": "x"})
    def fake_stream(prompt, context="", **k):
        yield {"type": "text", "text": "working"}
        yield {"type": "todos", "todos": [{"content": "step", "status": "pending"}]}
        yield {"type": "done", "text": "working"}
    monkeypatch.setattr(cr, "_agent_stream", fake_stream)

    r = client.post("/api/chat/stream", json={"text": "go deep", "tier": "agent"})
    evs = _events(r.text)
    assert any(e["type"] == "todos" for e in evs)
    assert evs[-1]["type"] == "done"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_chat_stream_endpoint.py -v`
Expected: FAIL — `/stream`, `cr.SessionLocal`, `cr._agent_stream` not present.

- [ ] **Step 3: Implement**

Add to `backend/modules/chat/router.py`. Add imports at top:

```python
import json
from fastapi.responses import StreamingResponse
from backend.core.db import SessionLocal
from backend.core.llm import ClaudeCliProvider
from backend.modules.agent import service
```

Add the indirection + endpoint:

```python
class StreamIn(BaseModel):
    text: str
    tier: str | None = None   # overrides the sticky tier for this message


def _agent_stream(prompt: str, context: str = "", **kw):
    """Indirection so tests can monkeypatch the CLI streaming call."""
    yield from ClaudeCliProvider().agent_stream(prompt, context=context)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.post("/stream")
def stream(body: StreamIn):
    # Own session: a StreamingResponse outlives the request scope, so we manage it here.
    def gen():
        db = SessionLocal()
        try:
            store.add_turn(db, "user", body.text)
            state = get_state(db)
            tier = body.tier or state.tier
            msgs = store.thread_messages(db)
            result = service.plan(db, msgs, tier=tier)
            kind = result.get("kind")
            assistant_text = ""
            todos = None

            if kind == "escalate" or tier == "agent":
                prompt = "\n\n".join(f"{m['role']}: {m['content']}" for m in msgs)
                context = f"{load_persona()}\n\n{_build_context(db)}"
                for ev in _agent_stream(prompt, context=context):
                    if ev["type"] == "text":
                        assistant_text += ev["text"]
                    elif ev["type"] == "todos":
                        todos = ev["todos"]
                    yield _sse(ev)
            elif kind == "action":
                out = service.run(db, result["tool"], result.get("args"))
                assistant_text = out.get("text", "")
                # let the UI optionally surface the action it ran
                yield _sse({"type": "action", "name": result["tool"]})
                yield _sse({"type": "text", "text": assistant_text})
                yield _sse({"type": "done", "text": assistant_text})
            else:  # reply (and skill, which returns reply/action already resolved)
                assistant_text = result.get("text", "") or result.get("ack", "")
                yield _sse({"type": "text", "text": assistant_text})
                yield _sse({"type": "done", "text": assistant_text})

            store.add_turn(db, "assistant", assistant_text, tier=tier)
        except Exception:  # noqa: BLE001 — never leak; close the stream cleanly
            yield _sse({"type": "error", "text": "I ran into a problem with that, sir."})
            yield _sse({"type": "done", "text": ""})
        finally:
            db.close()

    return StreamingResponse(gen(), media_type="text/event-stream")
```

> Note: the agent branch already receives a terminal `done` from `agent_stream`, so it isn't re-emitted. `tier` is persisted on the assistant turn so the UI can show which brain answered.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_chat_stream_endpoint.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `python -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/chat/router.py tests/test_chat_stream_endpoint.py
git commit -m "feat(chat): SSE /stream routing fast/smart/agent tiers"
```

---

### Task 5: Frontend SSE parser helper

**Files:**
- Create: `web/lib/sseParse.ts`
- Create: `web/check_sse.ts` (assertion)

- [ ] **Step 1: Write the failing assertion**

```typescript
// web/check_sse.ts — run: npx tsx web/check_sse.ts
import { parseSseChunk } from "./lib/sseParse";

// Two complete frames + a partial that must be carried over.
const chunk = 'data: {"type":"text","text":"hi"}\n\ndata: {"type":"done","text":"hi"}\n\ndata: {"type":"text"';
const { events, rest } = parseSseChunk("", chunk);
if (events.length !== 2) throw new Error(`expected 2 events, got ${events.length}`);
if (events[0].type !== "text" || (events[0] as any).text !== "hi") throw new Error("bad first event");
if (events[1].type !== "done") throw new Error("bad second event");
if (!rest.startsWith("data: {\"type\":\"text\"")) throw new Error("partial not carried over");
console.log("parseSseChunk: all cases pass");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web; npx tsx check_sse.ts`
Expected: FAIL — `sseParse` does not exist.

- [ ] **Step 3: Implement**

```typescript
// web/lib/sseParse.ts
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "todos"; todos: { content: string; status: string }[] }
  | { type: "tool"; name: string; summary: string }
  | { type: "action"; name: string }
  | { type: "error"; text: string }
  | { type: "done"; text: string };

/** Parse an SSE text chunk. `buffer` is leftover from the previous chunk.
 * Returns complete events plus the unparsed remainder to carry forward. */
export function parseSseChunk(buffer: string, chunk: string): { events: ChatEvent[]; rest: string } {
  const data = buffer + chunk;
  const parts = data.split("\n\n");
  const rest = parts.pop() ?? "";          // last piece may be incomplete
  const events: ChatEvent[] = [];
  for (const frame of parts) {
    const line = frame.split("\n").find(l => l.startsWith("data:"));
    if (!line) continue;
    try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
  }
  return { events, rest };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web; npx tsx check_sse.ts`
Expected: `parseSseChunk: all cases pass`

- [ ] **Step 5: Commit**

```bash
git add web/lib/sseParse.ts web/check_sse.ts
git commit -m "feat(chat): SSE chunk parser helper"
```

---

### Task 6: api.ts chat client

**Files:**
- Modify: `web/lib/api.ts` (add `chat` client + types; keep existing `ChatReply`)

- [ ] **Step 1: Add the client**

Append to `web/lib/api.ts` (after the `voice` client), importing the event type:

```typescript
import type { ChatEvent } from "./sseParse";
import { parseSseChunk } from "./sseParse";

export type ChatTurn = { role: "user" | "assistant"; content: string; tier: string | null };
export type ChatThread = { messages: ChatTurn[]; tier: string; mode: string };

export const chat = {
  thread:  ()                 => api.get<ChatThread>("/api/chat/thread"),
  setTier: (tier: string)     => api.post<{ tier: string }>("/api/chat/model", { tier }),
  setMode: (mode: string)     => api.post<{ mode: string }>("/api/chat/mode", { mode }),
  compact: ()                 => api.post<{ summary: string }>("/api/chat/compact", {}),
  // Stream a message; calls onEvent for each parsed ChatEvent until "done".
  async stream(text: string, tier: string | undefined, onEvent: (e: ChatEvent) => void): Promise<void> {
    const res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, tier }),
    });
    if (!res.body) throw new Error("no stream body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const { events, rest } = parseSseChunk(buffer, decoder.decode(value, { stream: true }));
      buffer = rest;
      for (const e of events) onEvent(e);
    }
  },
};
```

> Note: the `import` lines must go to the TOP of the file with the other imports (move them up if your editor places them inline). `ChatReply` stays for the old `POST /api/chat` voice path.

- [ ] **Step 2: Typecheck**

Run: `cd web; npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/lib/api.ts
git commit -m "feat(chat): api client (thread/stream/compact/setTier/setMode)"
```

---

### Task 7: Rebuild the chat page (streaming + todos + slash commands) — SUPERSEDED by Task 7R below (orb-launched translucent overlay). Skip this; implement Task 7R instead.

**Files:**
- Modify: `web/app/(console)/chat/page.tsx` (full rebuild)

- [ ] **Step 1: Implement the page**

Replace the contents of `web/app/(console)/chat/page.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { chat, ChatTurn } from "@/lib/api";
import type { ChatEvent } from "@/lib/sseParse";

type Todo = { content: string; status: string };
const TIERS = ["fast", "smart", "agent"] as const;
const SLASH = [
  { cmd: "/model", help: "switch brain: /model fast|smart|agent" },
  { cmd: "/compact", help: "summarize the conversation to save context" },
  { cmd: "/brainstorm", help: "guided design Q&A (one question at a time)" },
  { cmd: "/help", help: "show commands" },
];
const todoIcon = (s: string) => (s === "completed" ? "✓" : s === "in_progress" ? "◐" : "○");

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [tier, setTier] = useState("fast");
  const [mode, setMode] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");      // live assistant text
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chat.thread().then(t => { setMessages(t.messages); setTier(t.tier); setMode(t.mode); }); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming, todos]);

  const showSlash = input.startsWith("/") && !input.includes(" ");

  async function runSlash(raw: string): Promise<boolean> {
    const [cmd, arg] = raw.trim().split(/\s+/, 2);
    if (cmd === "/help") { setNote(SLASH.map(s => `${s.cmd} — ${s.help}`).join("\n")); return true; }
    if (cmd === "/model") {
      if (!TIERS.includes(arg as any)) { setNote(`Current brain: ${tier}. Use /model fast|smart|agent.`); return true; }
      await chat.setTier(arg); setTier(arg); setNote(`Brain set to ${arg}.`); return true;
    }
    if (cmd === "/compact") {
      setNote("Compacting…"); const { summary } = await chat.compact();
      setMessages([]); setNote(`Context compacted: ${summary}`); return true;
    }
    if (cmd === "/brainstorm") { await chat.setMode("brainstorm"); setMode("brainstorm"); setNote("Brainstorm mode on — I'll ask one question at a time. Type /exit to leave."); return true; }
    if (cmd === "/exit") { await chat.setMode(""); setMode(""); setNote("Brainstorm mode off."); return true; }
    return false;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (text.startsWith("/")) { if (await runSlash(text)) return; }

    setNote("");
    setMessages(m => [...m, { role: "user", content: text, tier: null }]);
    setBusy(true); setStreaming(""); setTodos([]); setTools([]);
    let acc = "";
    const onEvent = (ev: ChatEvent) => {
      if (ev.type === "text") { acc += ev.text; setStreaming(acc); }
      else if (ev.type === "todos") setTodos(ev.todos);
      else if (ev.type === "tool") setTools(t => [...t, ev.summary]);
      else if (ev.type === "error") { acc += ev.text; setStreaming(acc); }
      else if (ev.type === "done") { /* finalized below */ }
    };
    try {
      await chat.stream(text, tier, onEvent);
      setMessages(m => [...m, { role: "assistant", content: acc, tier }]);
    } catch (err: any) {
      setMessages(m => [...m, { role: "assistant", content: `Error: ${err.message}`, tier }]);
    } finally { setBusy(false); setStreaming(""); setTodos([]); setTools([]); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Chat with Jarvis</h1>
        <div className="flex items-center gap-2 text-xs">
          {mode === "brainstorm" && <span className="px-2 py-1 rounded-full bg-white/10">brainstorm</span>}
          <span className="px-2 py-1 rounded-full bg-jarvis-accent/20 text-jarvis-accent uppercase tracking-wide">{tier}</span>
        </div>
      </div>

      <div className="card min-h-[420px] max-h-[62vh] overflow-y-auto space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="text-sm text-jarvis-muted">
            Try “Plan my next 2 hours.” — or type <span className="text-jarvis-accent">/</span> for commands. Switch brains with <span className="text-jarvis-accent">/model agent</span> to let Jarvis work autonomously.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`text-sm ${m.role === "user" ? "text-right" : ""}`}>
            <div className={`inline-block px-3 py-2 rounded-2xl max-w-[80%] whitespace-pre-wrap
              ${m.role === "user" ? "bg-jarvis-accent text-jarvis-bg" : "bg-white/5"}`}>
              {m.content}
            </div>
          </div>
        ))}

        {/* live turn */}
        {(streaming || todos.length > 0 || tools.length > 0) && (
          <div className="text-sm space-y-2">
            {todos.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-1">
                <div className="text-xs uppercase tracking-wide text-jarvis-muted">Todos</div>
                {todos.map((t, i) => (
                  <div key={i} className={t.status === "completed" ? "line-through text-jarvis-muted" : ""}>
                    {todoIcon(t.status)} {t.content}
                  </div>
                ))}
              </div>
            )}
            {tools.map((t, i) => (
              <div key={i} className="text-xs text-jarvis-muted">⛭ {t}</div>
            ))}
            {streaming && (
              <div className="inline-block px-3 py-2 rounded-2xl max-w-[80%] whitespace-pre-wrap bg-white/5">
                {streaming}<span className="animate-pulse">▋</span>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {note && <div className="text-xs text-jarvis-muted whitespace-pre-wrap">{note}</div>}

      <div className="relative">
        {showSlash && (
          <div className="absolute bottom-full mb-1 w-full card p-1 text-sm">
            {SLASH.filter(s => s.cmd.startsWith(input)).map(s => (
              <button key={s.cmd} type="button" onClick={() => setInput(s.cmd + " ")}
                className="block w-full text-left px-2 py-1 rounded hover:bg-white/10">
                <span className="text-jarvis-accent">{s.cmd}</span> <span className="text-jarvis-muted">— {s.help}</span>
              </button>
            ))}
          </div>
        )}
        <form onSubmit={send} className="flex gap-2">
          <input className="input flex-1" placeholder="Ask Jarvis…  (/ for commands)"
                 value={input} onChange={e => setInput(e.target.value)} />
          <button className="btn" disabled={busy}>{busy ? "…" : "Send"}</button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web; npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/app/(console)/chat/page.tsx
git commit -m "feat(chat): Claude-Code-style page — streaming, todo panel, slash menu"
```

---

### Task 7R: Orb-launched translucent chat overlay (replaces Task 7)

The chat lives in a reusable `ChatPanel`. Clicking the existing bottom-right JARVIS orb opens it as a **centered, see-through, futuristic overlay** that ties into the UI (accent `#4ad6ff`, glass/backdrop-blur). Mounted globally so it works on every tab. The `/chat` route renders the same panel inline.

**Files:**
- Create: `web/components/chat/ChatPanel.tsx`
- Create: `web/components/chat/ChatLauncher.tsx` (context provider + overlay)
- Modify: `web/components/voice/AmbientOrb.tsx` (orb click opens the launcher)
- Modify: `web/app/(console)/layout.tsx` (wrap with provider + mount overlay)
- Modify: `web/app/(console)/chat/page.tsx` (render `ChatPanel` inline)

- [ ] **Step 1: Create `web/components/chat/ChatPanel.tsx`**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { chat, ChatTurn } from "@/lib/api";
import type { ChatEvent } from "@/lib/sseParse";

type Todo = { content: string; status: string };
const TIERS = ["fast", "smart", "agent"] as const;
const SLASH = [
  { cmd: "/model", help: "switch brain: /model fast|smart|agent" },
  { cmd: "/compact", help: "summarize the conversation to save context" },
  { cmd: "/brainstorm", help: "guided design Q&A (one question at a time)" },
  { cmd: "/help", help: "show commands" },
];
const todoIcon = (s: string) => (s === "completed" ? "✓" : s === "in_progress" ? "◐" : "○");

export function ChatPanel({ onClose }: { onClose?: () => void }) {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [tier, setTier] = useState("fast");
  const [mode, setMode] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chat.thread().then(t => { setMessages(t.messages); setTier(t.tier); setMode(t.mode); }); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming, todos]);

  const showSlash = input.startsWith("/") && !input.includes(" ");

  async function runSlash(raw: string): Promise<boolean> {
    const [cmd, arg] = raw.trim().split(/\s+/, 2);
    if (cmd === "/help") { setNote(SLASH.map(s => `${s.cmd} — ${s.help}`).join("\n")); return true; }
    if (cmd === "/model") {
      if (!TIERS.includes(arg as any)) { setNote(`Current brain: ${tier}. Use /model fast|smart|agent.`); return true; }
      await chat.setTier(arg); setTier(arg); setNote(`Brain set to ${arg}.`); return true;
    }
    if (cmd === "/compact") { setNote("Compacting…"); const { summary } = await chat.compact(); setMessages([]); setNote(`Context compacted: ${summary}`); return true; }
    if (cmd === "/brainstorm") { await chat.setMode("brainstorm"); setMode("brainstorm"); setNote("Brainstorm mode on — I'll ask one question at a time. Type /exit to leave."); return true; }
    if (cmd === "/exit") { await chat.setMode(""); setMode(""); setNote("Brainstorm mode off."); return true; }
    return false;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (text.startsWith("/")) { if (await runSlash(text)) return; }
    setNote("");
    setMessages(m => [...m, { role: "user", content: text, tier: null }]);
    setBusy(true); setStreaming(""); setTodos([]); setTools([]);
    let acc = "";
    const onEvent = (ev: ChatEvent) => {
      if (ev.type === "text") { acc += ev.text; setStreaming(acc); }
      else if (ev.type === "todos") setTodos(ev.todos);
      else if (ev.type === "tool") setTools(t => [...t, ev.summary]);
      else if (ev.type === "error") { acc += ev.text; setStreaming(acc); }
    };
    try {
      await chat.stream(text, tier, onEvent);
      setMessages(m => [...m, { role: "assistant", content: acc, tier }]);
    } catch (err: any) {
      setMessages(m => [...m, { role: "assistant", content: `Error: ${err.message}`, tier }]);
    } finally { setBusy(false); setStreaming(""); setTodos([]); setTools([]); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#4ad6ff]/15">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#4ad6ff] shadow-[0_0_10px_#4ad6ff]" />
          <span className="font-semibold tracking-wide">JARVIS</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {mode === "brainstorm" && <span className="px-2 py-1 rounded-full bg-white/10">brainstorm</span>}
          <span className="px-2 py-1 rounded-full bg-[#4ad6ff]/15 text-[#9fe6ff] uppercase tracking-wide">{tier}</span>
          {onClose && <button onClick={onClose} className="ml-1 text-jarvis-muted hover:text-white text-lg leading-none">×</button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="text-sm text-jarvis-muted">
            How can I help, sir? Type <span className="text-[#4ad6ff]">/</span> for commands, or <span className="text-[#4ad6ff]">/model agent</span> to let me work autonomously.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`text-sm ${m.role === "user" ? "text-right" : ""}`}>
            <div className={`inline-block px-3 py-2 rounded-2xl max-w-[85%] whitespace-pre-wrap ${m.role === "user" ? "bg-[#4ad6ff]/20 text-white" : "bg-white/5"}`}>{m.content}</div>
          </div>
        ))}
        {(streaming || todos.length > 0 || tools.length > 0) && (
          <div className="text-sm space-y-2">
            {todos.length > 0 && (
              <div className="rounded-xl border border-[#4ad6ff]/20 bg-white/5 p-3 space-y-1">
                <div className="text-xs uppercase tracking-wide text-jarvis-muted">Working</div>
                {todos.map((t, i) => (
                  <div key={i} className={t.status === "completed" ? "line-through text-jarvis-muted" : ""}>{todoIcon(t.status)} {t.content}</div>
                ))}
              </div>
            )}
            {tools.map((t, i) => (<div key={i} className="text-xs text-jarvis-muted">⛭ {t}</div>))}
            {streaming && (<div className="inline-block px-3 py-2 rounded-2xl max-w-[85%] whitespace-pre-wrap bg-white/5">{streaming}<span className="animate-pulse">▋</span></div>)}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {note && <div className="px-4 pb-2 text-xs text-jarvis-muted whitespace-pre-wrap">{note}</div>}

      <div className="relative px-3 pb-3">
        {showSlash && (
          <div className="absolute bottom-full mb-1 left-3 right-3 rounded-xl border border-[#4ad6ff]/20 bg-[#070d1a]/95 backdrop-blur-xl p-1 text-sm">
            {SLASH.filter(s => s.cmd.startsWith(input)).map(s => (
              <button key={s.cmd} type="button" onClick={() => setInput(s.cmd + " ")} className="block w-full text-left px-2 py-1 rounded hover:bg-white/10">
                <span className="text-[#4ad6ff]">{s.cmd}</span> <span className="text-jarvis-muted">— {s.help}</span>
              </button>
            ))}
          </div>
        )}
        <form onSubmit={send} className="flex gap-2">
          <input className="flex-1 rounded-xl bg-white/5 border border-[#4ad6ff]/20 px-3 py-2 outline-none focus:border-[#4ad6ff]/50 placeholder:text-jarvis-muted" placeholder="Ask Jarvis…  (/ for commands)" value={input} onChange={e => setInput(e.target.value)} autoFocus />
          <button className="btn" disabled={busy}>{busy ? "…" : "Send"}</button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/components/chat/ChatLauncher.tsx`**

```tsx
"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { ChatPanel } from "./ChatPanel";

const Ctx = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({ open: false, setOpen: () => {} });
export const useChatLauncher = () => useContext(Ctx);

export function ChatLauncherProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

export function ChatOverlay() {
  const { open, setOpen } = useChatLauncher();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) { setShown(false); return; }
    const id = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(id); window.removeEventListener("keydown", onKey); };
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[40] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-[#040810]/50 backdrop-blur-md"
           style={{ opacity: shown ? 1 : 0, transition: "opacity 200ms ease" }} />
      <div
        onClick={e => e.stopPropagation()}
        className="relative w-[min(94vw,760px)] h-[min(82vh,720px)] rounded-2xl border border-[#4ad6ff]/30 bg-[#070d1a]/70 backdrop-blur-2xl shadow-[0_0_80px_rgba(74,214,255,0.18)] overflow-hidden"
        style={{ transform: shown ? "scale(1)" : "scale(0.92)", opacity: shown ? 1 : 0, transformOrigin: "bottom right", transition: "transform 220ms cubic-bezier(.2,.8,.2,1), opacity 200ms ease" }}
      >
        <ChatPanel onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Make the orb clickable in `web/components/voice/AmbientOrb.tsx`**

Add the import and use the launcher; pass `onOrbClick` to `JarvisOrb` (its hit-circle sets `pointer-events: all`, which re-enables clicks inside the `pointer-events-none` wrapper):

```tsx
import { useChatLauncher } from "@/components/chat/ChatLauncher";
```

Inside the component, add `const { setOpen } = useChatLauncher();` and change the JarvisOrb render to:

```tsx
        <JarvisOrb className="w-[230px] h-[230px]" onOrbClick={() => setOpen(true)} />
```

- [ ] **Step 4: Wrap the layout + mount the overlay in `web/app/(console)/layout.tsx`**

Add imports and wrap the whole tree so `AmbientOrb` is inside the provider; mount `ChatOverlay`:

```tsx
import { ChatLauncherProvider, ChatOverlay } from "@/components/chat/ChatLauncher";
```

Wrap the existing return:

```tsx
  return (
    <ChatLauncherProvider>
      <VoiceProvider>
        <FlyoverProvider>
          <div className="flex min-h-screen grid-bg">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <HeaderBar />
              <main className="flex-1 p-5 overflow-x-hidden">{children}</main>
            </div>
          </div>
        </FlyoverProvider>
        <AmbientOrb />
        <VoiceIndicator />
      </VoiceProvider>
      <ChatOverlay />
    </ChatLauncherProvider>
  );
```

- [ ] **Step 5: Render the panel inline at `web/app/(console)/chat/page.tsx`**

```tsx
"use client";
import { ChatPanel } from "@/components/chat/ChatPanel";

export default function ChatPage() {
  return (
    <div className="mx-auto w-full max-w-3xl h-[calc(100vh-7rem)] rounded-2xl border border-[#4ad6ff]/20 bg-[#070d1a]/40 backdrop-blur-xl overflow-hidden">
      <ChatPanel />
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `cd web; npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/components/chat/ChatPanel.tsx web/components/chat/ChatLauncher.tsx web/components/voice/AmbientOrb.tsx "web/app/(console)/layout.tsx" "web/app/(console)/chat/page.tsx"
git commit -m "feat(chat): orb-launched translucent chat overlay"
```

> Notes: the overlay animates from the orb's corner (`transformOrigin: bottom right`) so it "pulls" to center. Esc and backdrop-click close it. The orb still serves voice (glide/pulse) — clicking it now also opens chat; these don't conflict. If any `text-jarvis-*` class is missing in the Tailwind config, fall back to a near-equivalent (`text-white/60`) — the `#4ad6ff` arbitrary values always work.

---

### Final verification

- [ ] **Run the full backend suite**

Run: `python -m pytest -q`
Expected: all green (146 from Plan A + new chat tests).

- [ ] **Typecheck the frontend**

Run: `cd web; npx tsc --noEmit`
Expected: clean.

- [ ] **Manual smoke (optional, requires running servers):**
  - Open the Chat page → it loads the persistent thread + tier badge.
  - Send a normal message → streams a reply; reload → message persists.
  - `/model agent` then "look at my finances and suggest one cut" → todo panel + tool chips appear, answer streams in.
  - `/compact` → history collapses to a summary note; conversation continues.
  - `/brainstorm` → JARVIS asks one question at a time; `/exit` leaves.

- [ ] **Dispatch the final reviewer** (per subagent-driven-development), then use **superpowers:finishing-a-development-branch**.

---

## Notes for the implementer

- `/stream` manages its own DB session (`SessionLocal`) because a `StreamingResponse` runs after the request scope closes — do NOT use `Depends(get_db)` there.
- The agent tier reuses Plan A's `ClaudeCliProvider.agent_stream` via the `_agent_stream` indirection (monkeypatchable).
- Brainstorm mode (`ChatState.mode`) is persisted and shown as a badge; the spec's deeper brainstorm prompt-shaping in `/stream` can be a thin follow-up (this plan wires the mode + `/brainstorm` `/exit` toggles and the badge; if you want the one-question-at-a-time prompting now, add a `mode`-aware system note in `_smart_answer`/`plan` — out of scope for the core tasks here).
- Keep the existing `POST /api/chat` (voice/back-compat) and `/briefing` untouched.
