"""Unify instruction skills (files) + action skills (agent registry), with an
enable/disable overlay from SkillSetting."""
from __future__ import annotations

from dataclasses import dataclass, field
from sqlalchemy.orm import Session

from backend.modules.agent import registry as actions   # data only (no import cycle)
from . import loader
from .models import SkillSetting

# Actions available in the default ("general") context when no specialized
# instruction skill is active. This preserves today's behavior.
GENERAL_ACTIONS = ["web_search", "weather", "navigate", "open_flyover", "look"]


@dataclass
class Skill:
    name: str
    kind: str                 # "instruction" | "action"
    when_to_use: str
    enabled: bool
    actions: list[str] = field(default_factory=list)   # instruction only
    body: str | None = None                             # instruction only


def _disabled_names(db: Session) -> set[str]:
    try:
        rows = db.query(SkillSetting).filter(SkillSetting.enabled == False).all()  # noqa: E712
        return {r.name for r in rows}
    except Exception:  # noqa: BLE001 — overlay is best-effort; absence => all enabled
        return set()


def _action_defs() -> dict[str, dict]:
    return {t["name"]: t for t in actions.TOOLS}


def all_skills(db: Session) -> list[Skill]:
    disabled = _disabled_names(db)
    out: list[Skill] = []
    for s in loader.load_skills():
        out.append(Skill(name=s.name, kind="instruction", when_to_use=s.when_to_use,
                         enabled=(s.enabled and s.name not in disabled),
                         actions=s.actions, body=s.body))
    for t in actions.TOOLS:
        out.append(Skill(name=t["name"], kind="action", when_to_use=t["desc"],
                         enabled=(t["name"] not in disabled)))
    return out


def enabled_instruction_skills(db: Session) -> list[Skill]:
    return [s for s in all_skills(db) if s.kind == "instruction" and s.enabled]


def get_instruction(db: Session, name: str) -> Skill | None:
    for s in all_skills(db):
        if s.kind == "instruction" and s.name == name:
            return s
    return None


def general_action_tools(db: Session) -> list[dict]:
    disabled = _disabled_names(db)
    defs = _action_defs()
    return [defs[n] for n in GENERAL_ACTIONS if n in defs and n not in disabled]


def skill_action_tools(db: Session, names: list[str]) -> list[dict]:
    disabled = _disabled_names(db)
    defs = _action_defs()
    return [defs[n] for n in names if n in defs and n not in disabled]


def render_actions(tools: list[dict]) -> str:
    if not tools:
        return "Available actions: (none)"
    lines = ["Available actions:"]
    for t in tools:
        lines.append(f'- {t["name"]}({t["args"]}) — {t["desc"]}')
    return "\n".join(lines)
