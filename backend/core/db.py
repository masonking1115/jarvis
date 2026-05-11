from pathlib import Path
from sqlalchemy import create_engine
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
