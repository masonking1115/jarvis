"""Fitness storage models.

NOTE: backend.core.db.init_db() does NOT import this module, so we create our
own tables here at import time. create_all is idempotent and only touches tables
registered on Base.metadata (i.e. the ones defined below).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, Integer, Float, DateTime, JSON, Text, inspect, text
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.db import Base, engine


class FitActivity(Base):
    __tablename__ = "fit_activities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stable de-dup key: sha256 of the .FIT file bytes. FIT files do not carry
    # Garmin Connect's activityId, so we key on content instead.
    fit_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    filename: Mapped[str | None] = mapped_column(String(256), default=None)
    # Optional: present only if a Garmin activityId is ever known. Nullable +
    # unique is fine on SQLite (multiple NULLs allowed).
    garmin_activity_id: Mapped[int | None] = mapped_column(Integer, unique=True, index=True, default=None)
    sport: Mapped[str | None] = mapped_column(String(64), default=None)
    sub_sport: Mapped[str | None] = mapped_column(String(64), default=None)
    start_time: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    duration_s: Mapped[float | None] = mapped_column(Float, default=None)
    distance_m: Mapped[float | None] = mapped_column(Float, default=None)
    avg_hr: Mapped[int | None] = mapped_column(Integer, default=None)
    max_hr: Mapped[int | None] = mapped_column(Integer, default=None)
    avg_speed: Mapped[float | None] = mapped_column(Float, default=None)
    calories: Mapped[int | None] = mapped_column(Integer, default=None)
    total_ascent: Mapped[float | None] = mapped_column(Float, default=None)
    samples: Mapped[list | None] = mapped_column(JSON, default=None)
    source: Mapped[str] = mapped_column(String(32), default="fit_import")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class WellnessDay(Base):
    __tablename__ = "wellness_days"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[str] = mapped_column(String(10), unique=True, index=True)  # YYYY-MM-DD
    steps: Mapped[int | None] = mapped_column(Integer, default=None)
    step_goal: Mapped[int | None] = mapped_column(Integer, default=None)
    resting_hr: Mapped[int | None] = mapped_column(Integer, default=None)
    sleep_seconds: Mapped[int | None] = mapped_column(Integer, default=None)
    sleep_score: Mapped[int | None] = mapped_column(Integer, default=None)
    body_battery: Mapped[int | None] = mapped_column(Integer, default=None)
    stress_avg: Mapped[int | None] = mapped_column(Integer, default=None)
    source: Mapped[str] = mapped_column(String(32), default="garmin")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SyncState(Base):
    __tablename__ = "sync_state"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # always 1
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    last_status: Mapped[str] = mapped_column(String(32), default="never")
    last_error: Mapped[str | None] = mapped_column(Text, default=None)
    items_synced: Mapped[int] = mapped_column(Integer, default=0)


# Drop a stale fit_activities table (pre-fit_hash schema) so create_all can
# rebuild it with the current columns. Safe: this table only ever holds imported
# activities, which are re-derivable from the source .FIT files.
_insp = inspect(engine)
if "fit_activities" in _insp.get_table_names():
    _cols = {c["name"] for c in _insp.get_columns("fit_activities")}
    if "fit_hash" not in _cols:
        # Migrate the pre-fit_hash schema, but only drop when the table is empty
        # so we never silently discard imported rows.
        with engine.begin() as _conn:
            _count = _conn.execute(text("SELECT COUNT(*) FROM fit_activities")).scalar()
            if _count == 0:
                _conn.execute(text("DROP TABLE fit_activities"))

# Create our tables now (idempotent).
Base.metadata.create_all(bind=engine)
