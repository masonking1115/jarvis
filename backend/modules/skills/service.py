"""Skill selection support for the planner: render the router context (stage 1)
and produce a scoped answer for a chosen instruction skill (stage 2)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.llm import get_provider
from backend.modules.chat.router import load_persona, _build_context
from backend.modules.agent.service import _parse   # agent.service does not import skills (no cycle)
from . import registry

_SKILL_ANSWER_INSTRUCTION = (
    "Respond with ONLY a JSON object — no prose, no code fences:\n"
    '- Answer: {"kind":"reply","text":"<concise spoken answer>"}\n'
    '- Action: {"kind":"action","tool":"<one of the actions above>","args":{...},'
    '"ack":"<short spoken acknowledgement>"}\n'
    "Use an action only if one clearly applies; otherwise reply."
)


def router_context(db: Session) -> str:
    """Stage-1 prompt fragment: general actions + enabled instruction skills."""
    parts = [registry.render_actions(registry.general_action_tools(db))]
    skills = registry.enabled_instruction_skills(db)
    if skills:
        lines = ['Available skills (return {"kind":"skill","name":"<name>"} to use one):']
        for s in skills:
            lines.append(f"- {s.name} — {s.when_to_use}")
        parts.append("\n".join(lines))
    return "\n\n".join(parts)


def answer(db: Session, name: str, messages: list[dict]) -> dict:
    """Stage 2: answer under one instruction skill, scoped to its actions."""
    skill = registry.get_instruction(db, name)
    if not skill:
        return {"kind": "reply", "text": "I can't find that skill, sir."}
    tools = registry.skill_action_tools(db, skill.actions)
    system = (
        load_persona() + "\n\n" + _build_context(db)
        + f"\n\n# Active skill: {skill.name}\n" + (skill.body or "")
        + "\n\n" + registry.render_actions(tools)
        + "\n\n" + _SKILL_ANSWER_INSTRUCTION
    )
    raw = get_provider().chat(system=system, messages=messages, model=settings.voice_model)
    out = _parse(raw)
    if out.get("kind") == "action" and out.get("tool") not in set(skill.actions):
        # model tried to use a tool this skill doesn't carry — fall back to a reply
        return {"kind": "reply", "text": out.get("ack") or out.get("text") or "Done, sir."}
    return out
