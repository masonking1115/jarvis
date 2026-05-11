from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from typing import Generator

from .config import settings


class Base(DeclarativeBase):
    pass


_url = settings.database_url
if _url.startswith("sqlite:///"):
    db_path = Path(_url.replace("sqlite:///", "", 1))
    if not db_path.is_absolute():
        db_path = (Path(__file__).resolve().parent.parent / db_path).resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    _url = f"sqlite:///{db_path.as_posix()}"

engine = create_engine(
    _url,
    connect_args={"check_same_thread": False} if _url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Import all module models so Base.metadata sees them
    from backend.modules import tasks, goals, schedule, workouts, finance, projects  # noqa: F401
    from backend.modules.projects import models as _project_models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _apply_lightweight_migrations()


def _apply_lightweight_migrations() -> None:
    """Add new columns to existing SQLite tables without dropping data.

    SQLAlchemy's create_all is idempotent for tables but won't add columns to
    existing ones. For the small handful of additive changes we make, this is
    enough — anything more complex should use Alembic.
    """
    if not _url.startswith("sqlite"):
        return
    additions = {
        "events": [
            ("category",     "VARCHAR(32) DEFAULT 'general'"),
            ("completed",    "BOOLEAN DEFAULT 0"),
            ("duration_min", "INTEGER"),
        ],
    }
    with engine.begin() as conn:
        for table, cols in additions.items():
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for name, ddl in cols:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
