from sqlalchemy import String, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class SkillSetting(Base):
    """Enable/disable overlay for a skill (instruction or action). Absence of a
    row means the skill uses its file/code default (enabled)."""
    __tablename__ = "skill_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
