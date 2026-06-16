"""Azure Neural TTS client. Returns mp3 bytes; never lets the key escape."""
from __future__ import annotations

from xml.sax.saxutils import escape
import httpx

from backend.core.config import settings

MAX_CHARS = 1500


class NotConfigured(Exception):
    pass


def synthesize(text: str, voice: str | None = None) -> bytes:
    if not settings.azure_speech_key:
        raise NotConfigured("Set AZURE_SPEECH_KEY in backend/.env")
    voice = voice or settings.jarvis_voice
    region = settings.azure_speech_region
    clean = (text or "").strip()[:MAX_CHARS]
    ssml = (
        f'<speak version="1.0" xml:lang="en-GB">'
        f'<voice name="{voice}"><prosody rate="-4%">{escape(clean)}</prosody></voice></speak>'
    )
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    r = httpx.post(
        url,
        headers={
            "Ocp-Apim-Subscription-Key": settings.azure_speech_key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            "User-Agent": "jarvis",
        },
        content=ssml.encode("utf-8"),
        timeout=30,
    )
    r.raise_for_status()
    return r.content
