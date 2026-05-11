"""Garmin Connect client wrapper.

Uses the unofficial `garminconnect` library. Auth flow:

1. Token cache (data/garmin_token/) — if present and valid, used directly.
2. Email/password from .env — used only to MINT a new token cache. The backend
   does NOT do interactive MFA prompts at runtime; if MFA is needed, the user
   must run `python -m backend.scripts.garmin_login` once to create the cache.

Calls are cached for 60s to avoid hammering Garmin's servers.
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from backend.core.config import settings


class GarminNotConfigured(Exception):
    """No credentials in .env."""


class GarminNotAuthenticated(Exception):
    """No valid cached token; user must run garmin_login script."""


_client = None
_client_loaded_at: float = 0.0
_cache: dict[str, tuple[float, Any]] = {}
_CACHE_TTL = 60.0


def _token_dir() -> Path:
    p = Path(settings.garmin_token_dir)
    if not p.is_absolute():
        p = (Path(__file__).resolve().parent.parent.parent / p).resolve()
    return p


def get_client():
    """Return a logged-in Garmin client, using the cached token only.

    Raises GarminNotConfigured / GarminNotAuthenticated if setup is incomplete.
    """
    global _client, _client_loaded_at

    # Reload the client every ~30 min in case the token rotates internally.
    if _client is not None and (time.time() - _client_loaded_at) < 1800:
        return _client

    try:
        from garminconnect import Garmin
    except ImportError as e:
        raise GarminNotConfigured("garminconnect not installed") from e

    token_dir = _token_dir()
    if not token_dir.exists() or not any(token_dir.iterdir()):
        if not settings.garmin_email or not settings.garmin_password:
            raise GarminNotConfigured(
                "GARMIN_EMAIL / GARMIN_PASSWORD not set in backend/.env"
            )
        raise GarminNotAuthenticated(
            "No cached Garmin token. Run once: "
            "python -m backend.scripts.garmin_login"
        )

    client = Garmin()
    try:
        client.login(tokenstore=str(token_dir))
    except Exception as e:  # noqa: BLE001
        raise GarminNotAuthenticated(
            f"Cached Garmin token rejected ({e}). Re-run: "
            "python -m backend.scripts.garmin_login"
        ) from e

    _client = client
    _client_loaded_at = time.time()
    return _client


def _cached(key: str, fn):
    now = time.time()
    hit = _cache.get(key)
    if hit and (now - hit[0]) < _CACHE_TTL:
        return hit[1]
    val = fn()
    _cache[key] = (now, val)
    return val


def status() -> dict:
    try:
        get_client()
        return {"configured": True, "authenticated": True}
    except GarminNotConfigured as e:
        return {"configured": False, "authenticated": False, "reason": str(e)}
    except GarminNotAuthenticated as e:
        return {"configured": True, "authenticated": False, "reason": str(e)}


def today_summary() -> dict:
    """User daily summary: steps, calories, active minutes, distance, HR."""
    from datetime import date
    return _cached("today_summary", lambda: get_client().get_user_summary(date.today().isoformat()))


def sleep_today() -> dict:
    from datetime import date
    return _cached("sleep_today", lambda: get_client().get_sleep_data(date.today().isoformat()))


def training_readiness() -> Any:
    from datetime import date
    return _cached("readiness", lambda: get_client().get_training_readiness(date.today().isoformat()))


def vo2_max() -> Any:
    from datetime import date
    return _cached("vo2", lambda: get_client().get_max_metrics(date.today().isoformat()))


def body_battery() -> Any:
    from datetime import date, timedelta
    end = date.today()
    start = end - timedelta(days=1)
    return _cached("battery", lambda: get_client().get_body_battery(start.isoformat(), end.isoformat()))


def recent_activities(limit: int = 5) -> list:
    return _cached(f"activities:{limit}", lambda: get_client().get_activities(0, limit))
