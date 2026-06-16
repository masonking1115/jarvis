from pathlib import Path
from sqlalchemy import create_engine, event, text
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
    connect_args={"check_same_thread": False, "timeout": 30} if _url.startswith("sqlite") else {},
)

if _url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _sqlite_busy_timeout(dbapi_conn, _):  # per-connection, cheap, no lock: wait up to
        cur = dbapi_conn.cursor()             # 30s for a writer instead of erroring "database is locked".
        cur.execute("PRAGMA busy_timeout=30000")
        cur.close()

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
    from backend.modules.gmail import models as _gmail_models  # noqa: F401
    from backend.modules.tax import models as _tax_models  # noqa: F401
    from backend.modules.flyover import models as _flyover_models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _apply_lightweight_migrations()
    # WAL improves reader/writer concurrency. Set once at startup; best-effort
    # (the one-time transition needs exclusive access, so don't fail if busy).
    if _url.startswith("sqlite"):
        try:
            with engine.begin() as conn:
                conn.execute(text("PRAGMA journal_mode=WAL"))
        except Exception:  # noqa: BLE001
            pass


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
        "assets": [
            ("source",      "VARCHAR(32) DEFAULT 'manual'"),
            ("external_id", "VARCHAR(128)"),
        ],
        "transactions": [
            ("source",      "VARCHAR(32) DEFAULT 'manual'"),
            ("external_id", "VARCHAR(128)"),
        ],
        "email_suppressed_senders": [
            ("filter_id", "VARCHAR(128)"),
        ],
        "liabilities": [
            ("source",      "VARCHAR(32) DEFAULT 'manual'"),
            ("external_id", "VARCHAR(128)"),
        ],
        "email_purchases": [
            ("liability_id", "INTEGER"),
        ],
    }
    with engine.begin() as conn:
        for table, cols in additions.items():
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for name, ddl in cols:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
