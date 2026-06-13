from backend.modules.fitness import models as m
from backend.core.db import engine
from sqlalchemy import inspect


def test_tables_exist_after_import():
    names = set(inspect(engine).get_table_names())
    assert {"fit_activities", "wellness_days", "sync_state"} <= names


def test_models_have_expected_columns():
    cols = {c.name for c in m.FitActivity.__table__.columns}
    assert {"garmin_activity_id", "sport", "start_time", "distance_m",
            "avg_hr", "samples", "source"} <= cols
    wcols = {c.name for c in m.WellnessDay.__table__.columns}
    assert {"date", "steps", "sleep_seconds", "body_battery"} <= wcols
