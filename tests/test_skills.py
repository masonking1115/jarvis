from backend.modules.skills import loader
from backend.modules.skills.loader import parse_skill


def test_parse_full_frontmatter():
    text = (
        "---\n"
        "name: trip-planner\n"
        "when_to_use: When planning travel.\n"
        "actions: [web_search, weather]\n"
        "enabled: true\n"
        "---\n"
        "You are a travel planner."
    )
    s = parse_skill(text)
    assert s is not None
    assert s.name == "trip-planner"
    assert s.when_to_use == "When planning travel."
    assert s.actions == ["web_search", "weather"]
    assert s.enabled is True
    assert s.body == "You are a travel planner."


def test_parse_empty_actions_and_default_enabled():
    text = "---\nname: x\nwhen_to_use: y\nactions: []\n---\nbody"
    s = parse_skill(text)
    assert s.actions == []
    assert s.enabled is True   # default when omitted


def test_parse_enabled_false():
    text = "---\nname: x\nwhen_to_use: y\nenabled: false\n---\nbody"
    assert parse_skill(text).enabled is False


def test_parse_missing_required_returns_none():
    assert parse_skill("---\nwhen_to_use: y\n---\nbody") is None   # no name
    assert parse_skill("no frontmatter at all") is None


def test_load_skills_reads_dir(tmp_path):
    (tmp_path / "a.md").write_text("---\nname: a\nwhen_to_use: ua\n---\nbody a", encoding="utf-8")
    (tmp_path / "bad.md").write_text("garbage", encoding="utf-8")   # skipped, no crash
    out = loader.load_skills(tmp_path)
    assert [s.name for s in out] == ["a"]


def test_load_skills_includes_seeds():
    names = [s.name for s in loader.load_skills()]   # default dir = backend/skills
    assert "tax-helper" in names and "fitness-coach" in names


import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.db import Base
from backend.modules.skills.models import SkillSetting


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[SkillSetting.__table__])
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    s = Session()
    try:
        yield s
    finally:
        s.close()


def test_skillsetting_defaults(db):
    row = SkillSetting(name="tax-helper")
    db.add(row); db.commit(); db.refresh(row)
    assert row.id is not None and row.enabled is True


from backend.modules.skills import registry


def test_all_skills_includes_both_kinds(db):
    skills = registry.all_skills(db)
    kinds = {s.name: s.kind for s in skills}
    assert kinds.get("tax-helper") == "instruction"
    assert kinds.get("weather") == "action"


def test_disable_overlay_hides_from_enabled(db):
    db.add(SkillSetting(name="tax-helper", enabled=False)); db.commit()
    enabled = {s.name for s in registry.enabled_instruction_skills(db)}
    assert "tax-helper" not in enabled
    assert "fitness-coach" in enabled


def test_general_actions_filtered_by_disable(db):
    names = [t["name"] for t in registry.general_action_tools(db)]
    assert "weather" in names
    db.add(SkillSetting(name="weather", enabled=False)); db.commit()
    names2 = [t["name"] for t in registry.general_action_tools(db)]
    assert "weather" not in names2


def test_skill_action_tools_scopes(db):
    tools = registry.skill_action_tools(db, ["web_search"])
    assert [t["name"] for t in tools] == ["web_search"]


def test_disabled_names_resilient_to_missing_table():
    # FakeDB has no real table; must not raise, returns empty set
    class FakeDB:
        def query(self, *a, **k): return self
        def filter(self, *a, **k): return self
        def all(self): raise RuntimeError("no such table")
    assert registry._disabled_names(FakeDB()) == set()
