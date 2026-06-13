"""Background import scheduler.

A single daemon thread wakes every FITNESS_SYNC_INTERVAL_MIN minutes and runs
run_import() — scanning the inbox folder and any connected Garmin USB device for
new .FIT files. Started once on first import of the fitness module. The thread is
cheap when there's nothing to do (empty inbox, no device → no-op).

Config via env (no edit to core/config.py):
  FITNESS_SYNC_ENABLED       default "true"
  FITNESS_SYNC_INTERVAL_MIN  default 10
"""
from __future__ import annotations

import os
import threading
import time

from backend.modules.fitness.ingest import run_import

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


def _loop() -> None:
    # Small initial delay so app startup isn't blocked by a first scan.
    time.sleep(10)
    while True:
        try:
            run_import()
        except Exception:  # noqa: BLE001 - run_import already swallows; belt-and-suspenders
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
