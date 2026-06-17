"""Skills endpoints (/api/skills): list all skills + enable/disable toggle."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from . import registry
from .models import SkillSetting

router = APIRouter()


class TogglePatch(BaseModel):
    enabled: bool


def _ser(s: registry.Skill) -> dict:
    return {"name": s.name, "kind": s.kind, "when_to_use": s.when_to_use,
            "actions": s.actions, "enabled": s.enabled}


@router.get("")
def list_skills(db: Session = Depends(get_db)):
    skills = registry.all_skills(db)
    return {"skills": [_ser(s) for s in skills], "count": len(skills)}


@router.patch("/{name}")
def toggle(name: str, body: TogglePatch, db: Session = Depends(get_db)):
    known = {s.name for s in registry.all_skills(db)}
    if name not in known:
        raise HTTPException(status_code=404, detail="skill not found")
    row = db.query(SkillSetting).filter(SkillSetting.name == name).first()
    if row is None:
        db.add(SkillSetting(name=name, enabled=body.enabled))
    else:
        row.enabled = body.enabled
    db.commit()
    return {"name": name, "enabled": body.enabled}
