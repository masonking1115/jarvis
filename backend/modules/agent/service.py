"""Agent action layer: plan (reply vs action) + run (backend tools)."""
from __future__ import annotations

import json
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.llm import get_provider, ClaudeCliProvider
from backend.modules.chat.router import load_persona
from backend.modules.flyover import geocode as fly_geocode, weather as fly_weather
from backend.modules.flyover.models import get_or_create as fly_settings
from . import registry

_PLAN_INSTRUCTION = (
    "Decide if the user's latest message needs an ACTION or just a REPLY.\n"
    "{tools}\n\n"
    "Respond with ONLY a JSON object — no prose, no code fences:\n"
    '- Plain answer: {"kind":"reply","text":"<concise spoken answer>"}\n'
    '- Action: {"kind":"action","tool":"<one of the action names>","args":{...},'
    '"ack":"<short spoken acknowledgement, e.g. \'Yes sir, performing the weather search now.\'>"}\n'
    "Use an action only when it clearly matches one above; otherwise reply."
)


def _parse(raw: str) -> dict:
    s = (raw or "").strip()
    if "```" in s:
        parts = s.split("```")
        s = parts[1] if len(parts) >= 2 else s.replace("```", "")
        if s.lower().startswith("json"):
            s = s[4:]
        s = s.strip()
    i, j = s.find("{"), s.rfind("}")
    if i != -1 and j != -1 and j > i:
        try:
            obj = json.loads(s[i:j + 1])
            if isinstance(obj, dict) and obj.get("kind") in ("reply", "action"):
                return obj
        except Exception:  # noqa: BLE001
            pass
    return {"kind": "reply", "text": (raw or "").strip() or "I'm not sure, sir."}


def plan(db: Session, messages: list[dict]) -> dict:
    provider = get_provider()
    system = load_persona() + "\n\n" + _PLAN_INSTRUCTION.replace("{tools}", registry.render())
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
        row = fly_settings(db)
        lat, lng, label = row.lat, row.lng, (row.address or "your location")
        if lat is None or lng is None:
            lat, lng = settings.flyover_default_lat, settings.flyover_default_lng
            label = settings.flyover_default_address
    w = fly_weather.current(lat, lng)
    temp = round(w["temp"]) if w.get("temp") is not None else "?"
    desc = w.get("description") or w.get("main") or "clear"
    return f"It's {temp} degrees, {desc}, in {label}, sir."


def run(db: Session, tool: str, args: dict | None) -> dict:
    args = args or {}
    try:
        if tool == "weather":
            return {"text": _weather_line(db, args.get("location"))}
        if tool == "web_search":
            provider = get_provider()
            q = args.get("query") or ""
            if isinstance(provider, ClaudeCliProvider) and provider.available:
                return {"text": provider.web_answer(q, model=settings.agent_search_model)}
            return {"text": provider.chat(
                system=load_persona(), messages=[{"role": "user", "content": q}], model=settings.voice_model)}
        return {"text": "I can't do that yet, sir."}
    except Exception:  # noqa: BLE001 — never leak keys/stack to the client
        return {"text": "I ran into a problem with that, sir."}
