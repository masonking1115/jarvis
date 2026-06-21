from datetime import datetime
from backend.modules.projects.schemas import ProjectOut


def test_projectout_has_status_fields():
    fields = ProjectOut.model_fields
    assert "status_summary" in fields and "last_active_at" in fields


def test_projectout_serializes_from_model():
    from types import SimpleNamespace
    obj = SimpleNamespace(id=1, name="X", status="active", progress=0.0,
                          notion_url=None, notes=None, repo_path=None,
                          created_at=datetime(2026, 6, 20),
                          status_summary="rollup", last_active_at=datetime(2026, 6, 20))
    out = ProjectOut.model_validate(obj)
    assert out.status_summary == "rollup"
    assert out.last_active_at == datetime(2026, 6, 20)
