"""Voice endpoints (/api/voice). Azure TTS proxy — the key stays server-side."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from backend.core.config import settings
from . import azure

router = APIRouter()


@router.get("/config")
def config():
    ok = bool(settings.azure_speech_key)
    out = {"available": ok, "voice": settings.jarvis_voice, "stt": ok}
    if not ok:
        out["reason"] = "Set AZURE_SPEECH_KEY in backend/.env"
    return out


class TtsIn(BaseModel):
    text: str
    voice: str | None = None


@router.post("/tts")
def tts(body: TtsIn):
    try:
        audio = azure.synthesize(body.text, body.voice)
    except azure.NotConfigured as e:
        return JSONResponse({"available": False, "reason": str(e)})
    except Exception:  # noqa: BLE001 — keep the key out of any error string
        return JSONResponse({"available": False, "reason": "tts failed"})
    return Response(content=audio, media_type="audio/mpeg")


@router.get("/stt-token")
def stt_token():
    try:
        token, region = azure.issue_token()
    except azure.NotConfigured as e:
        return JSONResponse({"available": False, "reason": str(e)})
    except Exception:  # noqa: BLE001 — never surface the key in an error
        return JSONResponse({"available": False, "reason": "stt token failed"})
    return {"token": token, "region": region}
