"""Discover and parse instruction skills from backend/skills/*.md."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

# backend/skills (loader.py is backend/modules/skills/loader.py)
SKILLS_DIR = Path(__file__).resolve().parent.parent.parent / "skills"


@dataclass
class InstructionSkill:
    name: str
    when_to_use: str
    body: str
    actions: list[str] = field(default_factory=list)
    enabled: bool = True


def _split_frontmatter(text: str) -> tuple[dict, str]:
    t = text.lstrip()
    if not t.startswith("---"):
        return {}, text
    rest = t[3:]
    end = rest.find("\n---")
    if end == -1:
        return {}, text
    fm, body = rest[:end], rest[end + 4:].lstrip("\n")
    meta: dict = {}
    for line in fm.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        k, _, v = line.partition(":")
        meta[k.strip().lower()] = v.strip()
    return meta, body


def _parse_list(v: str) -> list[str]:
    v = v.strip()
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    return [x.strip() for x in v.split(",") if x.strip()]


def parse_skill(text: str) -> InstructionSkill | None:
    meta, body = _split_frontmatter(text)
    name = meta.get("name", "").strip()
    when = meta.get("when_to_use", "").strip()
    if not name or not when:
        return None
    enabled = meta.get("enabled", "true").strip().lower() not in ("false", "0", "no")
    return InstructionSkill(name=name, when_to_use=when, body=body.strip(),
                            actions=_parse_list(meta.get("actions", "")), enabled=enabled)


def load_skills(skills_dir: Path | None = None) -> list[InstructionSkill]:
    d = Path(skills_dir) if skills_dir else SKILLS_DIR
    out: list[InstructionSkill] = []
    if not d.exists():
        return out
    for p in sorted(d.glob("*.md")):
        try:
            s = parse_skill(p.read_text(encoding="utf-8"))
            if s:
                out.append(s)
        except Exception:  # noqa: BLE001 — a bad file must never break discovery
            continue
    return out
