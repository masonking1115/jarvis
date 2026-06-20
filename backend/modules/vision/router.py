"""Vision endpoints (/api/vision). On-demand image understanding via Claude vision.

The browser captures a webcam frame (agnostic getUserMedia) and POSTs it here; we
answer with Claude vision. The image never leaves the local backend except to the
Anthropic API for the single request.
"""
import base64
import re

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.db import get_db

router = APIRouter()

_DATA_URL = re.compile(r"^data:(?P<mt>image/[a-zA-Z0-9.+-]+);base64,(?P<data>.+)$", re.DOTALL)


@router.get("/config")
def config():
    ok = bool(settings.anthropic_api_key)
    out = {"available": ok}
    if not ok:
        out["reason"] = "Vision needs an Anthropic API key (ANTHROPIC_API_KEY in backend/.env)."
    return out


class LookIn(BaseModel):
    image: str               # data URL ("data:image/jpeg;base64,…") or raw base64
    question: str | None = None
    media_type: str | None = None
    remember: bool = False   # if true, record the exchange in the persistent chat thread


def _remember(db: Session, question: str | None, answer: str) -> None:
    """Persist a vision exchange into the chat thread so JARVIS recalls what it saw."""
    try:
        from backend.modules.chat import store
        store.add_turn(db, "user", question or "(showed the camera)")
        store.add_turn(db, "assistant", answer, tier="vision")
    except Exception:  # noqa: BLE001 — memory is best-effort; never fail the look
        pass


@router.post("/look")
def look(body: LookIn, db: Session = Depends(get_db)):
    if not settings.anthropic_api_key:
        return JSONResponse({"text": "Vision isn't configured, sir — add an Anthropic API key."})
    media_type = body.media_type or "image/jpeg"
    data = body.image or ""
    m = _DATA_URL.match(data)
    if m:
        media_type = m.group("mt")
        data = m.group("data")
    if not data:
        return JSONResponse({"text": "I didn't receive an image, sir."})
    # Validate it's real base64 before sending upstream.
    try:
        base64.b64decode(data, validate=True)
    except Exception:  # noqa: BLE001
        return JSONResponse({"text": "That image didn't come through cleanly, sir."})
    try:
        from backend.core.llm import AnthropicProvider
        text = AnthropicProvider().vision(body.question or "What do you see?", data, media_type=media_type)
        text = text or "I couldn't make anything out, sir."
        if body.remember:
            _remember(db, body.question, text)
        return {"text": text}
    except Exception:  # noqa: BLE001 — never leak keys/stack
        return JSONResponse({"text": "I ran into a problem looking at that, sir."})
