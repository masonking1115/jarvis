"""Background poller: periodically screen new inbox mail, unattended.

Started/stopped by the app lifespan. Runs only when OAuth tokens exist; logs and
continues on error so a transient Gmail/LLM hiccup never crashes the app. The DB
write happens off the event loop (asyncio.to_thread) since SQLAlchemy is sync.
Mirrors modules/robinhood/scheduler.py.
"""
from __future__ import annotations

import asyncio
import logging

from backend.core.config import settings
from backend.core.db import SessionLocal
from . import client as gc
from . import oauth
from . import service

log = logging.getLogger("gmail.scheduler")
_task: asyncio.Task | None = None


async def _run_once() -> None:
    if not oauth.has_tokens():
        return  # nothing to do until the user signs in once

    def _do() -> dict:
        db = SessionLocal()
        try:
            result = service.sync_to_db(db)
            try:
                service.extract_finances_to_db(db)  # parse new financial emails -> liabilities
            except Exception:  # noqa: BLE001
                pass
            try:
                service.extract_purchases_to_db(db)  # parse receipts -> spending
            except Exception:  # noqa: BLE001
                pass
            try:
                service.ensure_daily_brief(db)  # once per day, after screening
            except Exception:  # noqa: BLE001 — brief failure must not break the sync loop
                pass
            return result
        finally:
            db.close()

    try:
        result = await asyncio.to_thread(_do)
        log.info("gmail screening ok: %s new, %s seen",
                 result.get("screened_new"), result.get("inbox_seen"))
    except (gc.GmailNotConnected, gc.GmailNotConfigured) as e:
        log.info("gmail screening skipped: %s", e)
    except Exception as e:  # noqa: BLE001 — never let a sync error kill the loop
        log.warning("gmail screening error: %s", e)


async def _loop() -> None:
    interval = max(1, settings.gmail_sync_interval_min) * 60
    await asyncio.sleep(12)  # let startup settle before the first poll
    while True:
        await _run_once()
        await asyncio.sleep(interval)


def start() -> None:
    global _task
    if _task is not None and not _task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # no event loop (e.g. under pytest import) — nothing to start
    _task = loop.create_task(_loop())
    log.info("gmail scheduler started (every %s min)", settings.gmail_sync_interval_min)


async def stop() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        _task = None
