# Garmin FIT Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically pull the user's Garmin activities (as original `.FIT`) and daily wellness on a 10-minute schedule, parse `.FIT` with the official FIT SDK, store to SQLite, and surface it in the Fitness tab.

**Architecture:** A background daemon thread uses the (already-installed) unofficial `garminconnect` client to download new activities and daily wellness. Activities are decoded with the official `garmin-fit-sdk`. Results are de-duped and upserted into SQLite tables owned by the fitness module. The Fitness tab reads from these tables and shows a sync-status indicator with a "Sync now" button.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 (`Mapped`/`mapped_column`), `garmin-fit-sdk` (parsing), `python-multipart` (uploads), pytest. Frontend: Next.js 14 + React + Tailwind.

> **PIVOT (2026-06-13), applied after Tasks 1–9:** Garmin SSO login 429s reliably for this account, so the login-based acquisition (Tasks 5/6's download path) was replaced with **file-based import** — `backend/modules/fitness/ingest.py` (watched inbox folder + connected Garmin USB `GARMIN/ACTIVITY` scan + upload endpoint), de-duped by `sha256` of the `.FIT` bytes. `sync.py` was deleted. Model gained `fit_hash`/`filename`; `garmin_activity_id` is now nullable. Endpoints `/sync/*` became `/import`, `/import/scan`, `/import/status`. Wellness deferred. Final state verified end-to-end against a real Garmin `.FIT` file: 35 tests pass.

---

## Conventions for this plan

- **Working directory** for all commands is the app root: `C:\Users\mking\Downloads\JARVIS\jarvis`.
- **Run tests with the project venv:** `.\.venv\Scripts\python.exe -m pytest <path> -v`
- **Imports use the `backend.` package root** (e.g. `from backend.core.db import Base`), matching existing modules.
- **Git note:** this folder is *not* a git repository. Each "Checkpoint" step is a pause-and-verify point. If you want real commits, run `git init` first; otherwise treat checkpoints as review gates (no `git` command needed).
- **Scope discipline:** Only touch `backend/modules/fitness/`, `backend/modules/garmin/client.py`, `web/app/(console)/fitness/page.tsx`, `tests/`, and a one-line append to `backend/requirements.txt`. Do **not** edit `backend/core/config.py`, `backend/core/db.py`, or `backend/main.py`. Another agent is working in this repo.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/modules/fitness/fit_parser.py` | Pure parsing: `.FIT` bytes → normalized activity dict; downsampling helper. No I/O, no network. |
| `backend/modules/fitness/models.py` | SQLAlchemy models `FitActivity`, `WellnessDay`, `SyncState`; self-creates tables at import. |
| `backend/modules/fitness/sync.py` | Acquisition + orchestration: `sync_activities`, `sync_wellness`, `run_sync`. Uses `garmin.client`. De-dupes, upserts, updates `SyncState`. |
| `backend/modules/fitness/scheduler.py` | Daemon thread; starts once; loops every interval; dormant until a Garmin token exists. |
| `backend/modules/fitness/__init__.py` | Router: existing `/today` + new endpoints; wires models/sync/scheduler on mount. |
| `backend/modules/garmin/client.py` | (additive) `download_activity_original(activity_id)`, `list_activities(start, limit)`. |
| `web/app/(console)/fitness/page.tsx` | Activity history, wellness strip, sync-status + "Sync now". |
| `tests/test_fit_parser.py` | Unit tests for downsampling + structural parse test. |
| `tests/test_fitness_sync.py` | De-dup/upsert/error-isolation tests with a fake client. |
| `tests/test_fitness_api.py` | Endpoint tests against an in-memory/temпорary DB. |
| `backend/requirements.txt` | (append) `garmin-fit-sdk`. |

---

## Task 1: Add the FIT SDK dependency

**Files:**
- Modify: `backend/requirements.txt` (append one line)

- [ ] **Step 1: Append the dependency**

Add this line to the end of `backend/requirements.txt` (keep existing lines unchanged):

```
garmin-fit-sdk==21.188.0
```

- [ ] **Step 2: Install it into the venv**

Run:
```
.\.venv\Scripts\python.exe -m pip install garmin-fit-sdk==21.188.0
```
Expected: "Successfully installed garmin-fit-sdk-21.188.0".

- [ ] **Step 3: Verify the import works**

Run:
```
.\.venv\Scripts\python.exe -c "from garmin_fit_sdk import Decoder, Stream; print('ok')"
```
Expected output: `ok`

- [ ] **Step 4: Checkpoint** — dependency installed and importable.

---

## Task 2: FIT parser — downsampling helper (pure logic, TDD)

**Files:**
- Create: `backend/modules/fitness/fit_parser.py`
- Test: `tests/test_fit_parser.py`

The parser splits into a pure `_downsample()` function (fully unit-tested with synthetic data, no real `.FIT` needed) and `parse_activity()` (tested with a real fixture in Task 3).

- [ ] **Step 1: Write the failing test for `_downsample`**

Create `tests/test_fit_parser.py`:

```python
from backend.modules.fitness.fit_parser import _downsample


def _records(n):
    return [
        {"timestamp": i, "heart_rate": 100 + i, "enhanced_speed": 2.0,
         "position_lat": 1, "position_long": 2, "enhanced_altitude": 10, "cadence": 80}
        for i in range(n)
    ]


def test_downsample_keeps_all_when_under_cap():
    out = _downsample(_records(50), cap=200)
    assert len(out) == 50
    assert out[0]["hr"] == 100
    assert out[0]["speed"] == 2.0


def test_downsample_caps_large_input():
    out = _downsample(_records(2000), cap=200)
    assert len(out) <= 200
    # first and last samples are preserved
    assert out[0]["hr"] == 100
    assert out[-1]["hr"] == 100 + 1999


def test_downsample_handles_missing_fields():
    out = _downsample([{"timestamp": 5}], cap=200)
    assert out == [{"t": 5, "hr": None, "speed": None,
                    "lat": None, "lon": None, "alt": None, "cad": None}]


def test_downsample_empty():
    assert _downsample([], cap=200) == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fit_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.modules.fitness.fit_parser'`.

- [ ] **Step 3: Implement `fit_parser.py` with `_downsample` and field maps**

Create `backend/modules/fitness/fit_parser.py`:

```python
"""Parse Garmin .FIT activity files into normalized dicts.

Pure module: no network, no DB. Uses the official `garmin_fit_sdk` decoder.
"""
from __future__ import annotations

from typing import Any


# FIT record field -> our sample key. enhanced_* fields are preferred when present.
_SAMPLE_FIELDS = [
    ("hr", ("heart_rate",)),
    ("speed", ("enhanced_speed", "speed")),
    ("lat", ("position_lat",)),
    ("lon", ("position_long",)),
    ("alt", ("enhanced_altitude", "altitude")),
    ("cad", ("cadence",)),
]


def _pick(rec: dict, names: tuple[str, ...]) -> Any:
    for n in names:
        if rec.get(n) is not None:
            return rec[n]
    return None


def _sample(rec: dict) -> dict:
    out: dict[str, Any] = {"t": rec.get("timestamp")}
    for key, names in _SAMPLE_FIELDS:
        out[key] = _pick(rec, names)
    return out


def _downsample(records: list[dict], cap: int = 200) -> list[dict]:
    """Map FIT record messages to compact samples, capped to `cap` points.

    Always preserves the first and last record. Uniform stride in between.
    """
    if not records:
        return []
    if len(records) <= cap:
        return [_sample(r) for r in records]
    stride = len(records) / cap
    picked = [records[min(int(i * stride), len(records) - 1)] for i in range(cap)]
    picked[-1] = records[-1]  # guarantee the final point
    return [_sample(r) for r in picked]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fit_parser.py -v`
Expected: 4 passed.

- [ ] **Step 5: Checkpoint** — downsampling logic implemented and tested.

---

## Task 3: FIT parser — `parse_activity` (real file)

**Files:**
- Modify: `backend/modules/fitness/fit_parser.py`
- Test: `tests/test_fit_parser.py`
- Fixture: `tests/fixtures/sample_activity.fit`

- [ ] **Step 1: Obtain a sample `.FIT` fixture**

Create the folder `tests/fixtures/` and place one real Original-format activity file there as `sample_activity.fit`. To get one: in Garmin Connect web, open any activity → gear menu → **Export Original** → unzip → copy the `.fit` file in. (This fixture is only for tests; not committed to any external service.)

If no fixture is available yet, the integration test in this task auto-skips, and you can return to it later — the rest of the plan does not depend on it.

- [ ] **Step 2: Write the failing test for `parse_activity`**

Append to `tests/test_fit_parser.py`:

```python
import os
import pytest

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "sample_activity.fit")


@pytest.mark.skipif(not os.path.exists(FIXTURE), reason="no sample_activity.fit fixture")
def test_parse_activity_structure():
    from backend.modules.fitness.fit_parser import parse_activity
    with open(FIXTURE, "rb") as fh:
        result = parse_activity(fh.read())

    # Summary keys always present (values may be None for sparse files).
    for key in ("sport", "sub_sport", "start_time", "duration_s", "distance_m",
                "avg_hr", "max_hr", "avg_speed", "calories", "total_ascent", "samples"):
        assert key in result

    assert isinstance(result["samples"], list)
    assert len(result["samples"]) <= 200
    for s in result["samples"]:
        assert set(s.keys()) == {"t", "hr", "speed", "lat", "lon", "alt", "cad"}
```

- [ ] **Step 3: Run the test**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fit_parser.py::test_parse_activity_structure -v`
Expected: FAIL with `ImportError: cannot import name 'parse_activity'` (or SKIPPED if no fixture — in that case implement Step 4 anyway).

- [ ] **Step 4: Implement `parse_activity`**

Append to `backend/modules/fitness/fit_parser.py`:

```python
from datetime import datetime, timezone


class FitParseError(Exception):
    """Raised when a .FIT file cannot be decoded into an activity."""


def _to_dt(value: Any) -> datetime | None:
    """garmin_fit_sdk returns datetimes (convert_datetimes_to_dates=True by default)."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


def parse_activity(fit_bytes: bytes) -> dict:
    """Decode a .FIT activity file into a normalized activity dict.

    Raises FitParseError if the bytes are not a readable FIT activity.
    """
    from garmin_fit_sdk import Decoder, Stream

    stream = Stream.from_byte_array(bytearray(fit_bytes))
    decoder = Decoder(stream)
    if not decoder.is_fit():
        raise FitParseError("not a FIT file")

    messages, _errors = decoder.read()  # errors are tolerated; partial reads still usable

    sessions = messages.get("session_mesgs") or []
    records = messages.get("record_mesgs") or []
    if not sessions and not records:
        raise FitParseError("FIT file has no session or record messages")

    sess = sessions[0] if sessions else {}

    avg_speed = sess.get("enhanced_avg_speed")
    if avg_speed is None:
        avg_speed = sess.get("avg_speed")

    return {
        "sport": sess.get("sport"),                 # decoded to string by default
        "sub_sport": sess.get("sub_sport"),
        "start_time": _to_dt(sess.get("start_time")),
        "duration_s": sess.get("total_elapsed_time"),
        "distance_m": sess.get("total_distance"),
        "avg_hr": sess.get("avg_heart_rate"),
        "max_hr": sess.get("max_heart_rate"),
        "avg_speed": avg_speed,
        "calories": sess.get("total_calories"),
        "total_ascent": sess.get("total_ascent"),
        "samples": _downsample(records, cap=200),
    }
```

- [ ] **Step 5: Run the test**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fit_parser.py -v`
Expected: all `_downsample` tests pass; `test_parse_activity_structure` passes (or skips if no fixture).

- [ ] **Step 6: Checkpoint** — parser complete.

---

## Task 4: Database models (self-creating tables)

**Files:**
- Create: `backend/modules/fitness/models.py`
- Test: `tests/test_fitness_models.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_fitness_models.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fitness_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.modules.fitness.models'`.

- [ ] **Step 3: Implement `models.py`**

Create `backend/modules/fitness/models.py`:

```python
"""Fitness storage models.

NOTE: backend.core.db.init_db() does NOT import this module, so we create our
own tables here at import time. create_all is idempotent and only touches tables
registered on Base.metadata (i.e. the ones defined below).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, Integer, Float, DateTime, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.core.db import Base, engine


class FitActivity(Base):
    __tablename__ = "fit_activities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    garmin_activity_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
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
    source: Mapped[str] = mapped_column(String(32), default="garmin_fit")
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


# Create our tables now (idempotent).
Base.metadata.create_all(bind=engine)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fitness_models.py -v`
Expected: 2 passed.

- [ ] **Step 5: Checkpoint** — models and tables in place.

---

## Task 5: Garmin client — download & list helpers (additive)

**Files:**
- Modify: `backend/modules/garmin/client.py` (append functions; do not change existing ones)
- Test: `tests/test_garmin_download.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_garmin_download.py`:

```python
from backend.modules.garmin import client as gc


class _FakeRaw:
    def __init__(self):
        self.calls = []

    def get_activities(self, start, limit):
        self.calls.append(("get_activities", start, limit))
        return [{"activityId": 111}, {"activityId": 222}]

    def download_activity(self, activity_id, dl_fmt=None):
        self.calls.append(("download", activity_id, dl_fmt))
        return b"PK\x03\x04zip-bytes"


def test_list_activities_delegates(monkeypatch):
    fake = _FakeRaw()
    monkeypatch.setattr(gc, "get_client", lambda: fake)
    out = gc.list_activities(0, 5)
    assert out == [{"activityId": 111}, {"activityId": 222}]
    assert ("get_activities", 0, 5) in fake.calls


def test_download_original_returns_bytes(monkeypatch):
    fake = _FakeRaw()
    monkeypatch.setattr(gc, "get_client", lambda: fake)
    data = gc.download_activity_original(111)
    assert data == b"PK\x03\x04zip-bytes"
    assert any(c[0] == "download" and c[1] == 111 for c in fake.calls)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_garmin_download.py -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'list_activities'`.

- [ ] **Step 3: Append helpers to `client.py`**

Add to the end of `backend/modules/garmin/client.py`:

```python
def list_activities(start: int = 0, limit: int = 20) -> list:
    """Raw activity list (uncached) for the sync job to find new activities."""
    result = get_client().get_activities(start, limit)
    return result if isinstance(result, list) else []


def download_activity_original(activity_id: int) -> bytes:
    """Download an activity in Garmin's ORIGINAL format (a .zip of the .FIT)."""
    from garminconnect import Garmin
    return get_client().download_activity(
        activity_id, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_garmin_download.py -v`
Expected: 2 passed.

- [ ] **Step 5: Checkpoint** — acquisition helpers ready.

---

## Task 6: Sync orchestration (de-dup, upsert, error isolation, TDD)

**Files:**
- Create: `backend/modules/fitness/sync.py`
- Test: `tests/test_fitness_sync.py`

`sync.py` depends only on: `garmin.client` (monkeypatched in tests), `fit_parser`, `models`, and `SessionLocal`. The zip→.fit extraction lives here.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_fitness_sync.py`:

```python
import io
import zipfile

import pytest

from backend.core.db import SessionLocal
from backend.modules.fitness import sync, models


@pytest.fixture(autouse=True)
def clean_db():
    db = SessionLocal()
    db.query(models.FitActivity).delete()
    db.query(models.WellnessDay).delete()
    db.commit()
    db.close()
    yield


def _zip_of(fit_bytes: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("activity.fit", fit_bytes)
    return buf.getvalue()


def test_extract_fit_from_zip():
    raw = b"FITDATA"
    assert sync._extract_fit(_zip_of(raw)) == raw


def test_extract_fit_passthrough_when_not_zip():
    raw = b"\x0e\x10notazip"
    assert sync._extract_fit(raw) == raw


def test_sync_activities_inserts_and_dedupes(monkeypatch):
    monkeypatch.setattr(sync.gc, "list_activities",
                        lambda start, limit: [{"activityId": 1}, {"activityId": 2}])
    monkeypatch.setattr(sync.gc, "download_activity_original",
                        lambda aid: _zip_of(b"fit"))
    monkeypatch.setattr(sync, "parse_activity",
                        lambda b: {"sport": "running", "sub_sport": None,
                                   "start_time": None, "duration_s": 60.0,
                                   "distance_m": 100.0, "avg_hr": 150, "max_hr": 170,
                                   "avg_speed": 2.0, "calories": 10, "total_ascent": 1.0,
                                   "samples": []})
    n1 = sync.sync_activities(backfill=20)
    assert n1 == 2
    # Second run: same IDs already stored -> no new inserts.
    n2 = sync.sync_activities(backfill=20)
    assert n2 == 0

    db = SessionLocal()
    assert db.query(models.FitActivity).count() == 2
    db.close()


def test_sync_activities_isolates_per_item_failure(monkeypatch):
    monkeypatch.setattr(sync.gc, "list_activities",
                        lambda start, limit: [{"activityId": 1}, {"activityId": 2}])

    def flaky_download(aid):
        if aid == 1:
            raise RuntimeError("boom")
        return _zip_of(b"fit")

    monkeypatch.setattr(sync.gc, "download_activity_original", flaky_download)
    monkeypatch.setattr(sync, "parse_activity",
                        lambda b: {"sport": "cycling", "sub_sport": None,
                                   "start_time": None, "duration_s": 1.0,
                                   "distance_m": 1.0, "avg_hr": None, "max_hr": None,
                                   "avg_speed": None, "calories": None,
                                   "total_ascent": None, "samples": []})
    n = sync.sync_activities(backfill=20)
    assert n == 1  # activity 2 stored; activity 1 skipped, no crash


def test_sync_wellness_upserts_by_date(monkeypatch):
    monkeypatch.setattr(sync.gc, "today_summary",
                        lambda: {"totalSteps": 8000, "dailyStepGoal": 10000,
                                 "restingHeartRate": 52})
    monkeypatch.setattr(sync.gc, "sleep_today",
                        lambda: {"dailySleepDTO": {"sleepTimeSeconds": 27000,
                                                   "sleepScores": {"overall": {"value": 80}}}})
    monkeypatch.setattr(sync.gc, "body_battery", lambda: [{"charged": 65}])
    monkeypatch.setattr(sync, "_stress_avg", lambda: 30)

    sync.sync_wellness()
    sync.sync_wellness()  # second call updates the same row, not a duplicate

    db = SessionLocal()
    rows = db.query(models.WellnessDay).all()
    assert len(rows) == 1
    assert rows[0].steps == 8000
    assert rows[0].sleep_seconds == 27000
    assert rows[0].sleep_score == 80
    assert rows[0].body_battery == 65
    assert rows[0].resting_hr == 52
    db.close()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fitness_sync.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.modules.fitness.sync'`.

- [ ] **Step 3: Implement `sync.py`**

Create `backend/modules/fitness/sync.py`:

```python
"""Acquire Garmin data and persist it.

Acquisition uses the unofficial garmin client (backend.modules.garmin.client).
Activity files are parsed with the official FIT SDK via fit_parser.parse_activity.
All DB access goes through SessionLocal. Designed to be called from a scheduler
thread or an API endpoint.
"""
from __future__ import annotations

import io
import zipfile
from datetime import date, datetime

from backend.core.db import SessionLocal
from backend.modules.garmin import client as gc
from backend.modules.fitness.fit_parser import parse_activity, FitParseError
from backend.modules.fitness import models


def _extract_fit(blob: bytes) -> bytes:
    """ORIGINAL downloads are a .zip containing the .fit. Pass raw bytes through."""
    if blob[:4] == b"PK\x03\x04":
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            fit_name = next((n for n in zf.namelist() if n.lower().endswith(".fit")), None)
            if fit_name is None:
                raise FitParseError("zip contains no .fit file")
            return zf.read(fit_name)
    return blob


def _existing_ids() -> set[int]:
    db = SessionLocal()
    try:
        return {row[0] for row in db.query(models.FitActivity.garmin_activity_id).all()}
    finally:
        db.close()


def sync_activities(backfill: int = 20) -> int:
    """Download + parse + store any activities not already in the DB.

    Returns the number of newly stored activities. Per-activity failures are
    isolated (logged into SyncState by the caller via run_sync) and skipped.
    """
    activities = gc.list_activities(0, backfill)
    known = _existing_ids()
    stored = 0
    for a in activities:
        aid = a.get("activityId")
        if aid is None or aid in known:
            continue
        try:
            blob = gc.download_activity_original(aid)
            parsed = parse_activity(_extract_fit(blob))
        except Exception:  # noqa: BLE001 - isolate one bad activity from the batch
            continue
        db = SessionLocal()
        try:
            db.add(models.FitActivity(
                garmin_activity_id=aid,
                sport=parsed["sport"], sub_sport=parsed["sub_sport"],
                start_time=parsed["start_time"], duration_s=parsed["duration_s"],
                distance_m=parsed["distance_m"], avg_hr=parsed["avg_hr"],
                max_hr=parsed["max_hr"], avg_speed=parsed["avg_speed"],
                calories=parsed["calories"], total_ascent=parsed["total_ascent"],
                samples=parsed["samples"], source="garmin_fit",
            ))
            db.commit()
            stored += 1
        finally:
            db.close()
    return stored


def _stress_avg() -> int | None:
    try:
        data = gc.get_client().get_stress_data(date.today().isoformat())
        val = data.get("avgStressLevel") if isinstance(data, dict) else None
        return int(val) if isinstance(val, (int, float)) and val >= 0 else None
    except Exception:  # noqa: BLE001
        return None


def _latest_body_battery() -> int | None:
    try:
        bb = gc.body_battery()
        if isinstance(bb, list) and bb:
            charged = bb[-1].get("charged")
            if isinstance(charged, (int, float)):
                return int(charged)
    except Exception:  # noqa: BLE001
        pass
    return None


def sync_wellness() -> None:
    """Upsert today's wellness snapshot keyed by date."""
    today = date.today().isoformat()

    steps = step_goal = resting_hr = sleep_seconds = sleep_score = None
    try:
        s = gc.today_summary()
        if isinstance(s, dict):
            steps = int(s.get("totalSteps") or 0)
            step_goal = int(s.get("dailyStepGoal") or 0) or None
            rhr = s.get("restingHeartRate")
            resting_hr = int(rhr) if isinstance(rhr, (int, float)) else None
    except Exception:  # noqa: BLE001
        pass

    try:
        sl = gc.sleep_today()
        dto = sl.get("dailySleepDTO") if isinstance(sl, dict) else None
        if isinstance(dto, dict):
            secs = dto.get("sleepTimeSeconds")
            sleep_seconds = int(secs) if isinstance(secs, (int, float)) else None
            scores = dto.get("sleepScores") or {}
            overall = (scores.get("overall") or {}).get("value")
            sleep_score = int(overall) if isinstance(overall, (int, float)) else None
    except Exception:  # noqa: BLE001
        pass

    body_batt = _latest_body_battery()
    stress = _stress_avg()

    db = SessionLocal()
    try:
        row = db.query(models.WellnessDay).filter_by(date=today).one_or_none()
        if row is None:
            row = models.WellnessDay(date=today)
            db.add(row)
        row.steps = steps
        row.step_goal = step_goal
        row.resting_hr = resting_hr
        row.sleep_seconds = sleep_seconds
        row.sleep_score = sleep_score
        row.body_battery = body_batt
        row.stress_avg = stress
        row.source = "garmin"
        row.updated_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()


def _set_state(status: str, error: str | None, items: int) -> None:
    db = SessionLocal()
    try:
        row = db.get(models.SyncState, 1)
        if row is None:
            row = models.SyncState(id=1)
            db.add(row)
        row.last_status = status
        row.last_error = error
        row.items_synced = items
        if status == "ok":
            row.last_sync_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()


def run_sync(backfill: int = 20) -> dict:
    """Full sync pass. Never raises; records outcome in SyncState. Returns status dict."""
    try:
        gc.get_client()  # raises if not configured/authenticated
    except (gc.GarminNotConfigured, gc.GarminNotAuthenticated) as e:
        _set_state("needs_login", str(e), 0)
        return {"status": "needs_login", "reason": str(e), "items": 0}

    items = 0
    try:
        items = sync_activities(backfill=backfill)
        sync_wellness()
    except Exception as e:  # noqa: BLE001
        _set_state("error", str(e), items)
        return {"status": "error", "reason": str(e), "items": items}

    _set_state("ok", None, items)
    return {"status": "ok", "items": items}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fitness_sync.py -v`
Expected: 6 passed.

- [ ] **Step 5: Checkpoint** — sync logic complete and isolated from real network.

---

## Task 7: Scheduler (daemon thread, starts once, dormant until authed)

**Files:**
- Create: `backend/modules/fitness/scheduler.py`
- Test: `tests/test_fitness_scheduler.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_fitness_scheduler.py`:

```python
from backend.modules.fitness import scheduler


def test_config_defaults(monkeypatch):
    monkeypatch.delenv("FITNESS_SYNC_ENABLED", raising=False)
    monkeypatch.delenv("FITNESS_SYNC_INTERVAL_MIN", raising=False)
    monkeypatch.delenv("FITNESS_ACTIVITY_BACKFILL", raising=False)
    assert scheduler._enabled() is True
    assert scheduler._interval_seconds() == 600
    assert scheduler._backfill() == 20


def test_config_overrides(monkeypatch):
    monkeypatch.setenv("FITNESS_SYNC_ENABLED", "false")
    monkeypatch.setenv("FITNESS_SYNC_INTERVAL_MIN", "5")
    monkeypatch.setenv("FITNESS_ACTIVITY_BACKFILL", "7")
    assert scheduler._enabled() is False
    assert scheduler._interval_seconds() == 300
    assert scheduler._backfill() == 7


def test_start_is_idempotent(monkeypatch):
    monkeypatch.setattr(scheduler, "_loop", lambda: None)
    scheduler._started = False
    t1 = scheduler.start()
    t2 = scheduler.start()
    assert t1 is t2  # second call returns the same thread, does not spawn another
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fitness_scheduler.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.modules.fitness.scheduler'`.

- [ ] **Step 3: Implement `scheduler.py`**

Create `backend/modules/fitness/scheduler.py`:

```python
"""Background sync scheduler.

A single daemon thread wakes every FITNESS_SYNC_INTERVAL_MIN minutes and runs
run_sync(). It is started once on first import of the fitness module. The thread
is cheap when dormant: run_sync() returns quickly with status 'needs_login' if no
Garmin token exists yet.

Config via env (no edit to core/config.py):
  FITNESS_SYNC_ENABLED       default "true"
  FITNESS_SYNC_INTERVAL_MIN  default 10
  FITNESS_ACTIVITY_BACKFILL  default 20
"""
from __future__ import annotations

import os
import threading
import time

from backend.modules.fitness.sync import run_sync

_started = False
_thread: threading.Thread | None = None
_lock = threading.Lock()


def _enabled() -> bool:
    return os.getenv("FITNESS_SYNC_ENABLED", "true").strip().lower() not in ("0", "false", "no")


def _interval_seconds() -> int:
    try:
        return max(60, int(os.getenv("FITNESS_SYNC_INTERVAL_MIN", "10")) * 60)
    except ValueError:
        return 600


def _backfill() -> int:
    try:
        return max(1, int(os.getenv("FITNESS_ACTIVITY_BACKFILL", "20")))
    except ValueError:
        return 20


def _loop() -> None:
    # Small initial delay so app startup isn't blocked by a first sync.
    time.sleep(10)
    while True:
        try:
            run_sync(backfill=_backfill())
        except Exception:  # noqa: BLE001 - run_sync already swallows, this is belt-and-suspenders
            pass
        time.sleep(_interval_seconds())


def start() -> threading.Thread | None:
    """Start the daemon thread once. Returns the thread (or None if disabled)."""
    global _started, _thread
    with _lock:
        if _started:
            return _thread
        _started = True
        if not _enabled():
            return None
        _thread = threading.Thread(target=_loop, name="fitness-sync", daemon=True)
        _thread.start()
        return _thread
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fitness_scheduler.py -v`
Expected: 3 passed.

- [ ] **Step 5: Checkpoint** — scheduler ready (not yet wired to the app).

---

## Task 8: Router endpoints + wiring

**Files:**
- Modify: `backend/modules/fitness/__init__.py`
- Test: `tests/test_fitness_api.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_fitness_api.py`:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.modules.fitness import router as fitness_router
from backend.core.db import SessionLocal
from backend.modules.fitness import models


def _client():
    app = FastAPI()
    app.include_router(fitness_router, prefix="/api/fitness")
    return TestClient(app)


def test_activities_endpoint_returns_stored(monkeypatch):
    db = SessionLocal()
    db.query(models.FitActivity).delete()
    db.add(models.FitActivity(garmin_activity_id=999, sport="running",
                              distance_m=5000.0, duration_s=1500.0, avg_hr=150,
                              samples=[{"t": 1, "hr": 150, "speed": 3.0,
                                        "lat": None, "lon": None, "alt": None, "cad": 80}]))
    db.commit()
    db.close()

    c = _client()
    r = c.get("/api/fitness/activities")
    assert r.status_code == 200
    body = r.json()
    assert any(a["garmin_activity_id"] == 999 for a in body["activities"])
    # list endpoint omits heavy samples
    assert "samples" not in body["activities"][0]

    detail = c.get("/api/fitness/activities/999")
    assert detail.status_code == 200
    assert detail.json()["samples"][0]["hr"] == 150


def test_sync_status_endpoint():
    c = _client()
    r = c.get("/api/fitness/sync/status")
    assert r.status_code == 200
    assert "last_status" in r.json()
    assert "interval_min" in r.json()


def test_sync_now_triggers_run(monkeypatch):
    import backend.modules.fitness as fitness_pkg
    monkeypatch.setattr(fitness_pkg, "run_sync", lambda backfill=20: {"status": "ok", "items": 3})
    c = _client()
    r = c.post("/api/fitness/sync/now")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["items"] == 3
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fitness_api.py -v`
Expected: FAIL — endpoints `/activities`, `/sync/status`, `/sync/now` return 404, and `run_sync` is not importable from the package.

- [ ] **Step 3: Rewrite `backend/modules/fitness/__init__.py`**

Replace the contents of `backend/modules/fitness/__init__.py` with (keeps the existing `/today` behavior and demo fallback, adds new endpoints, starts the scheduler):

```python
"""Fitness module.

Serves stored Garmin data (activities + daily wellness) collected by the
background sync job. `/today` still falls back to demo numbers so the dashboard
always renders.
"""
import os

from fastapi import APIRouter

from backend.core.db import SessionLocal
from backend.modules.garmin import client as gc
from backend.modules.fitness import models
from backend.modules.fitness.sync import run_sync
from backend.modules.fitness.scheduler import start as start_scheduler

router = APIRouter()

_PLACEHOLDER = {
    "placeholder": True,
    "source": "demo",
    "rings": [
        {"name": "Move",     "value": 542, "goal": 700, "unit": "cal", "color": "#4ad6ff"},
        {"name": "Exercise", "value": 38,  "goal": 60,  "unit": "min", "color": "#22e8a0"},
        {"name": "Stand",    "value": 9,   "goal": 12,  "unit": "hr",  "color": "#ffb547"},
    ],
    "distance_mi": 8.42,
    "wellness_pct": 82,
}


def _today_from_store() -> dict | None:
    from datetime import date
    db = SessionLocal()
    try:
        row = db.query(models.WellnessDay).filter_by(date=date.today().isoformat()).one_or_none()
    finally:
        db.close()
    if row is None or row.steps is None:
        return None
    steps = row.steps or 0
    step_goal = row.step_goal or 10000
    distance_mi = None  # wellness day doesn't carry distance; left to activities view
    wellness = row.body_battery if row.body_battery is not None else min(
        100, int(70 + (steps / max(step_goal, 1)) * 20))
    return {
        "placeholder": False,
        "source": "garmin",
        "rings": [
            {"name": "Steps",  "value": steps,                 "goal": step_goal, "unit": "steps", "color": "#4ad6ff"},
            {"name": "Sleep",  "value": round((row.sleep_seconds or 0) / 3600, 1), "goal": 8, "unit": "hr", "color": "#22e8a0"},
            {"name": "Resting","value": row.resting_hr or 0,   "goal": 60,        "unit": "bpm",   "color": "#ffb547"},
        ],
        "distance_mi": distance_mi or 0.0,
        "wellness_pct": wellness,
    }


def _activity_summary(a: models.FitActivity) -> dict:
    return {
        "garmin_activity_id": a.garmin_activity_id,
        "sport": a.sport, "sub_sport": a.sub_sport,
        "start_time": a.start_time.isoformat() if a.start_time else None,
        "duration_s": a.duration_s, "distance_m": a.distance_m,
        "avg_hr": a.avg_hr, "max_hr": a.max_hr, "avg_speed": a.avg_speed,
        "calories": a.calories, "total_ascent": a.total_ascent,
    }


@router.get("/today")
def today():
    return _today_from_store() or _PLACEHOLDER


@router.get("/activities")
def activities(limit: int = 25, offset: int = 0):
    db = SessionLocal()
    try:
        q = (db.query(models.FitActivity)
               .order_by(models.FitActivity.start_time.desc().nullslast())
               .offset(offset).limit(limit))
        return {"activities": [_activity_summary(a) for a in q.all()]}
    finally:
        db.close()


@router.get("/activities/{activity_id}")
def activity_detail(activity_id: int):
    db = SessionLocal()
    try:
        a = db.query(models.FitActivity).filter_by(garmin_activity_id=activity_id).one_or_none()
        if a is None:
            return {"available": False, "reason": "not found"}
        out = _activity_summary(a)
        out["samples"] = a.samples or []
        return out
    finally:
        db.close()


@router.get("/wellness")
def wellness(days: int = 14):
    db = SessionLocal()
    try:
        rows = (db.query(models.WellnessDay)
                  .order_by(models.WellnessDay.date.desc())
                  .limit(days).all())
        return {"days": [
            {"date": r.date, "steps": r.steps, "step_goal": r.step_goal,
             "resting_hr": r.resting_hr, "sleep_seconds": r.sleep_seconds,
             "sleep_score": r.sleep_score, "body_battery": r.body_battery,
             "stress_avg": r.stress_avg}
            for r in rows]}
    finally:
        db.close()


@router.get("/sync/status")
def sync_status():
    st = gc.status()
    db = SessionLocal()
    try:
        row = db.get(models.SyncState, 1)
    finally:
        db.close()
    return {
        "authenticated": st.get("authenticated", False),
        "configured": st.get("configured", False),
        "last_status": row.last_status if row else "never",
        "last_sync_at": row.last_sync_at.isoformat() if row and row.last_sync_at else None,
        "last_error": row.last_error if row else None,
        "items_synced": row.items_synced if row else 0,
        "interval_min": int(os.getenv("FITNESS_SYNC_INTERVAL_MIN", "10")),
    }


@router.post("/sync/now")
def sync_now():
    return run_sync(backfill=int(os.getenv("FITNESS_ACTIVITY_BACKFILL", "20")))


# Kick off the background sync thread when this module is mounted.
start_scheduler()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_fitness_api.py -v`
Expected: 3 passed.

- [ ] **Step 5: Run the full test suite**

Run: `.\.venv\Scripts\python.exe -m pytest tests/ -v`
Expected: all fitness/garmin tests pass; pre-existing tests unaffected.

- [ ] **Step 6: Checkpoint** — backend complete and wired.

---

## Task 9: Frontend — Fitness tab UI

**Files:**
- Modify: `web/app/(console)/fitness/page.tsx`

- [ ] **Step 1: Replace the page**

Replace the contents of `web/app/(console)/fitness/page.tsx` with:

```tsx
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Panel } from "@/components/Panel";
import { Ring } from "@/components/Ring";
import { StatusPill } from "@/components/StatusPill";

type SyncStatus = {
  authenticated: boolean; configured: boolean;
  last_status: string; last_sync_at: string | null;
  last_error: string | null; items_synced: number; interval_min: number;
};
type Activity = {
  garmin_activity_id: number; sport: string | null; start_time: string | null;
  duration_s: number | null; distance_m: number | null;
  avg_hr: number | null; calories: number | null;
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export default function FitnessPage() {
  const [data, setData] = useState<any>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    api.get("/api/fitness/today").then(setData).catch(console.error);
    api.get<SyncStatus>("/api/fitness/sync/status").then(setSync).catch(() => setSync(null));
    api.get<{ activities: Activity[] }>("/api/fitness/activities?limit=15")
      .then((d) => setActs(d.activities)).catch(() => setActs([]));
  };

  useEffect(() => { refresh(); }, []);

  const syncNow = async () => {
    setBusy(true);
    try { await api.post("/api/fitness/sync/now", {}); refresh(); }
    finally { setBusy(false); }
  };

  const live = data && data.placeholder === false;
  const authed = sync?.authenticated;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Fitness</h1>
        {sync && (
          <StatusPill
            status={authed ? "online" : sync.configured ? "warn" : "offline"}
            label={authed ? "GARMIN LINKED" : sync.configured ? "GARMIN AUTH" : "GARMIN OFFLINE"}
          />
        )}
        <div className="ml-auto flex items-center gap-3 text-xs text-jarvis-muted">
          <span>synced {ago(sync?.last_sync_at ?? null)}{sync ? ` · every ${sync.interval_min}m` : ""}</span>
          <button
            onClick={syncNow} disabled={busy}
            className="px-3 py-1 rounded border border-jarvis-border bg-jarvis-bg2 text-jarvis-accent disabled:opacity-50">
            {busy ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      <Panel title="Today" demo={!live} right={<span className="font-ui tracking-widest text-jarvis-amber">{live ? "GARMIN" : "DEMO"}</span>}>
        {!data ? <div className="text-jarvis-muted text-sm">Loading…</div> : (
          <div className="flex justify-around">
            {data.rings.map((r: any) => (
              <Ring key={r.name} value={r.value} max={r.goal} color={r.color} size={120} stroke={10}
                label={`${r.value}`} sub={`${r.name.toUpperCase()} · ${r.unit}`} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Recent activities" right={<span className="text-xs text-jarvis-muted">{acts.length} shown</span>}>
        {acts.length === 0 ? (
          <div className="text-jarvis-muted text-sm">No activities synced yet.</div>
        ) : (
          <ul className="divide-y divide-jarvis-border">
            {acts.map((a) => (
              <li key={a.garmin_activity_id} className="py-2 flex items-center gap-4 text-sm">
                <span className="w-24 text-jarvis-accent capitalize">{a.sport ?? "activity"}</span>
                <span className="w-32 text-jarvis-muted">{a.start_time ? new Date(a.start_time).toLocaleDateString() : "—"}</span>
                <span className="w-24">{a.distance_m != null ? `${(a.distance_m / 1609.344).toFixed(2)} mi` : "—"}</span>
                <span className="w-24">{a.duration_s != null ? `${Math.round(a.duration_s / 60)} min` : "—"}</span>
                <span className="w-20">{a.avg_hr != null ? `${a.avg_hr} bpm` : "—"}</span>
                <span className="w-20 text-jarvis-muted">{a.calories != null ? `${a.calories} cal` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {!authed && (
        <Panel title="Connect Garmin (one-time)">
          <ol className="text-sm text-jarvis-dim space-y-2 list-decimal pl-5">
            <li>Set <code className="text-jarvis-accent">GARMIN_EMAIL</code> and <code className="text-jarvis-accent">GARMIN_PASSWORD</code> in <code className="text-jarvis-accent">backend/.env</code>.</li>
            <li>From the app root, run once:<br />
              <code className="block mt-1 p-2 rounded bg-jarvis-bg2 border border-jarvis-border text-jarvis-accent">.\.venv\Scripts\python.exe -m backend.scripts.garmin_login</code>
            </li>
            <li>Enter your 2FA code if prompted. A token is cached to <code className="text-jarvis-accent">data/garmin_token/</code>.</li>
            <li>That's it — JARVIS then auto-syncs every {sync?.interval_min ?? 10} minutes. No further manual steps.</li>
          </ol>
          {sync?.last_error && (
            <div className="mt-3 text-[12px] text-jarvis-muted">Last error: <span className="text-jarvis-warn">{sync.last_error}</span></div>
          )}
        </Panel>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify `api.post` exists**

Open `web/lib/api.ts` (or `.tsx`) and confirm there is a `post` method. If `api` only has `get`, add a `post` helper following the existing `get` pattern (same base URL, `method: "POST"`, `headers: {"Content-Type": "application/json"}`, `body: JSON.stringify(payload)`). Do not change `get`.

- [ ] **Step 3: Type-check the frontend**

Run:
```
cd web; .\node_modules\.bin\tsc --noEmit; cd ..
```
Expected: no type errors in `fitness/page.tsx`. (If `tsc` isn't available, run `npm run build` in `web/` and confirm the fitness route compiles.)

- [ ] **Step 4: Checkpoint** — UI complete.

---

## Task 10: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: One-time Garmin login**

Run (interactive — enter 2FA if prompted):
```
.\.venv\Scripts\python.exe -m backend.scripts.garmin_login
```
Expected: "Logged in. Token cache saved…".

- [ ] **Step 2: Start the backend**

Run:
```
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000
```
Expected: starts clean; within ~10s the fitness-sync thread runs its first pass (no traceback).

- [ ] **Step 3: Hit the endpoints**

In another shell:
```
.\.venv\Scripts\python.exe -c "import httpx; print(httpx.get('http://localhost:8000/api/fitness/sync/status').json())"
.\.venv\Scripts\python.exe -c "import httpx; print(httpx.get('http://localhost:8000/api/fitness/activities').json())"
```
Expected: `sync/status` shows `authenticated: true` and a recent `last_sync_at`; `activities` lists your real activities.

- [ ] **Step 4: Verify the UI**

Start the frontend (`cd web; npm run dev`), open the Fitness tab. Expected: "GARMIN LINKED", "synced just now · every 10m", real rings, and a populated "Recent activities" list. Click **Sync now** → list refreshes without error.

- [ ] **Step 5: Final checkpoint** — feature verified end-to-end.

---

## Self-Review (completed during authoring)

- **Spec coverage:** acquisition (Task 5,6) ✓; FIT parsing (Task 2,3) ✓; storage models incl. SyncState (Task 4) ✓; scheduler 10-min/dormant/once (Task 7) ✓; all 6 API endpoints (Task 8) ✓; UI history + status + Sync-now + one-time-login hint (Task 9) ✓; wellness-as-JSON nuance (Task 6 `sync_wellness`) ✓; scope discipline / no shared-file edits beyond `requirements.txt` (Tasks 4,7,8 use `os.getenv` + self-create tables) ✓; graceful degradation when unauthenticated (Task 6 `run_sync`, Task 8 `/today` fallback) ✓.
- **Placeholder scan:** no TBD/TODO; every code step is complete.
- **Type/name consistency:** `parse_activity`/`_downsample`/`_extract_fit`/`run_sync`/`sync_activities`/`sync_wellness`/`start`, model field names, and the `samples` key shape (`t,hr,speed,lat,lon,alt,cad`) match across parser, sync, models, API, and UI.
