"""Background poller: periodically sync Robinhood data, unattended.

Started/stopped by the app lifespan. Runs only when OAuth tokens exist; logs and
continues on error so a transient SnapTrade hiccup never crashes the app. The DB
write happens off the event loop (asyncio.to_thread) since SQLAlchemy is sync.
"""
from __future__ import annotations

import asyncio
import logging

from backend.core.config import settings
from backend.core.db import SessionLocal
from . import client as rc
from . import oauth
from . import service

log = logging.getLogger("robinhood.scheduler")
_task: asyncio.Task | None = None


async def _run_once() -> None:
    if not oauth.has_tokens():
        return  # nothing to do until the user signs in once

    def _do() -> dict:
        db = SessionLocal()
        try:
            return service.sync_to_db(db)
        finally:
            db.close()

    try:
        result = await asyncio.to_thread(_do)
        log.info(
            "robinhood auto-sync ok: %s assets, %s txns",
            result.get("assets_synced"), result.get("transactions_synced"),
        )
    except (rc.SnapTradeNotConnected, rc.SnapTradeNotConfigured) as e:
        log.info("robinhood auto-sync skipped: %s", e)
    except Exception as e:  # noqa: BLE001 — never let a sync error kill the loop
        log.warning("robinhood auto-sync error: %s", e)


async def _loop() -> None:
    interval = max(1, settings.snaptrade_sync_interval_min) * 60
    await asyncio.sleep(10)  # let startup settle before the first poll
    while True:
        await _run_once()
        await asyncio.sleep(interval)


def start() -> None:
    """Kick off the polling loop on the running event loop (no-op if already running)."""
    global _task
    if _task is not None and not _task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # no event loop (e.g. under pytest import) — nothing to start
    _task = loop.create_task(_loop())
    log.info("robinhood scheduler started (every %s min)", settings.snaptrade_sync_interval_min)


async def stop() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        _task = None
