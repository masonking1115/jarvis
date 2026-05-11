# Jarvis

Personal life-optimization hub. Runs locally on Windows; frontend + backend are decoupled so an iOS app can plug into the same API later.

## Architecture

```
backend/     FastAPI + SQLAlchemy + SQLite — REST API on :8000
  core/        config, db, module registry, LLM abstraction (Anthropic + OpenAI)
  modules/     each subfolder auto-mounts at /api/<name>
    tasks/  goals/  schedule/  workouts/  finance/  chat/
web/         Next.js 14 (App Router) + Tailwind — UI on :3000
data/        SQLite file (auto-created, gitignored)
```

The module registry in [backend/core/registry.py](backend/core/registry.py) scans `backend/modules/` and mounts any subpackage that exposes a `router`. To add a module: create a folder, expose `router = APIRouter()` in its `__init__.py`, restart. That's the entire extension API.

## Setup (one-time)

```powershell
.\setup.ps1
```

Installs the Python venv, backend deps, and web deps. Creates `backend/.env` from the example. Add your API key(s) there:

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# or
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

Without a key, the chat module returns stub responses so the rest of the app still works.

## Run

Two terminals:

```powershell
.\run-backend.ps1     # FastAPI on http://localhost:8000  (docs: /docs)
.\run-web.ps1         # Next.js on http://localhost:3000
```

Open http://localhost:3000.

## What's in the MVP

- **Hub** — today's schedule, open tasks, goals, finance summary, daily briefing button (LLM-generated).
- **Tasks** — CRUD with priority + due dates.
- **Goals** — categorized, progress sliders.
- **Schedule** — events for today.
- **Workouts** — manual log (kind, duration, distance).
- **Finance** — transactions + income/expense/net summary.
- **Chat** — talk to Jarvis. The system prompt includes your open tasks and goals as context, so it can give grounded recommendations.

## Roadmap to iOS

The FastAPI backend is provider-neutral and already speaks JSON over HTTP. To go iOS:

1. Expose the backend on your LAN (or via Tailscale for outside access).
2. Build a SwiftUI app that calls the same `/api/*` endpoints. Or wrap the existing PWA in a native shell.
3. Add an auth layer (the current build is single-user, no auth — fine for localhost).

## Adding a new module (example)

```python
# backend/modules/trading/__init__.py
from .router import router
__all__ = ["router"]

# backend/modules/trading/router.py
from fastapi import APIRouter
router = APIRouter()

@router.get("/signals")
def signals():
    return {"signals": []}
```

Restart the backend. `/api/trading/signals` is live. Add a page at `web/app/trading/page.tsx` for the UI.
