"""Agent action layer: plan (reply vs action) + run (backend tools)."""
from __future__ import annotations

import json
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.llm import get_provider, ClaudeCliProvider
from backend.modules.chat.router import load_persona
from backend.modules.flyover import geocode as fly_geocode, weather as fly_weather
from backend.modules.flyover.models import get_or_create as fly_settings
from backend.modules.profile import storage as profile_storage
from . import registry

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
            if isinstance(obj, dict) and obj.get("kind") in ("reply", "action", "skill", "escalate"):
                return obj
        except Exception:  # noqa: BLE001
            pass
    return {"kind": "reply", "text": (raw or "").strip() or "I'm not sure, sir."}


def _smart_answer(db: Session, messages: list[dict], extra_context: str | None = None) -> dict:
    from backend.modules.skills import service as skills_service
    provider = get_provider()
    facts = profile_storage.get_context(db)
    system = load_persona()
    if facts:
        system += "\n\n" + facts
    if extra_context:
        system += "\n\n" + extra_context
    system += "\n\n" + skills_service.router_context(db)
    text = provider.chat(system=system, messages=messages, model=settings.smart_model)
    return {"kind": "reply", "text": (text or "").strip() or "I'm not sure, sir."}


def plan(db: Session, messages: list[dict], skill: str | None = None,
         tier: str | None = None, extra_context: str | None = None) -> dict:
    # Lazy import avoids an import cycle (skills.service imports agent.service._parse).
    # extra_context: optional data snapshot (e.g. the chat's finance/tasks/goals
    # context) appended to the system so the fast/smart tiers can answer data
    # questions directly instead of punting to an action. Voice omits it (stays lean).
    from backend.modules.skills import service as skills_service
    if skill:
        return skills_service.answer(db, skill, messages)
    if tier == "agent":
        return {"kind": "escalate", "reason": "forced agent tier"}
    if tier == "smart":
        return _smart_answer(db, messages, extra_context=extra_context)

    provider = get_provider()
    facts = profile_storage.get_context(db)
    system = load_persona()
    if facts:
        system += "\n\n" + facts
    if extra_context:
        system += "\n\n" + extra_context
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
            q = args.get("query") or ""
            # Hybrid: web search always goes through the Claude CLI (Max plan),
            # which has live WebSearch/WebFetch tools — even when the default
            # provider is the (faster) Anthropic API, which has no web access.
            cli = ClaudeCliProvider()
            if cli.available:
                return {"text": cli.web_answer(q, model=settings.agent_search_model)}
            provider = get_provider()
            return {"text": provider.chat(
                system=load_persona(), messages=[{"role": "user", "content": q}], model=settings.voice_model)}
        return {"text": "I can't do that yet, sir."}
    except Exception:  # noqa: BLE001 — never leak keys/stack to the client
        return {"text": "I ran into a problem with that, sir."}
