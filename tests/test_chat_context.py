from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from backend.core.db import Base
import backend.modules.projects.models  # noqa: F401
import backend.modules.chat.models      # noqa: F401


def _db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def test_build_context_lists_projects():
    import backend.modules.chat.router as cr
    from backend.modules.projects.models import Project
    from backend.modules.chat import store
    db = _db()
    a = Project(name="Alpha", status_summary="shipped the parser"); db.add(a)
    b = Project(name="Beta"); db.add(b); db.commit()
    store.add_turn(db, "assistant", "beta latest progress note", project_id=b.id)

    ctx = cr._build_context(db)
    assert "## Projects" in ctx
    assert "Alpha" in ctx and "shipped the parser" in ctx          # uses status_summary
    assert "Beta" in ctx and "beta latest progress note" in ctx    # falls back to turn snippet


def test_build_context_excludes_done_projects():
    import backend.modules.chat.router as cr
    from backend.modules.projects.models import Project
    db = _db()
    db.add(Project(name="Finished", status="done", status_summary="all done")); db.commit()
    assert "Finished" not in cr._build_context(db)
