"""Jarvis backend entrypoint.

Run from the repo root:
    uvicorn backend.main:app --reload --port 8000
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.core.config import settings
from backend.core.db import init_db
from backend.core.registry import discover_and_mount


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    app.state.modules = discover_and_mount(app)
    yield


app = FastAPI(title="Jarvis", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/modules")
def list_modules():
    return [{"name": m.name, "prefix": m.prefix} for m in app.state.modules]
