"""Flyover service: location persistence + weather lookup."""
from __future__ import annotations

from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from backend.core.config import settings
from .models import FlyoverSettings, get_or_create
from . import weather


def _effective_location(s) -> tuple[str | None, float | None, float | None]:
    """User-set location if present, else the configured default (Atherton)."""
    if s.lat is not None and s.lng is not None:
        return s.address, s.lat, s.lng
    return (settings.flyover_default_address,
            settings.flyover_default_lat,
            settings.flyover_default_lng)


def get_config(db: Session) -> dict:
    if not settings.google_maps_api_key:
        return {"available": False, "reason": "Set GOOGLE_MAPS_API_KEY in backend/.env"}
    s = get_or_create(db)
    address, lat, lng = _effective_location(s)
    return {
        "available": True,
        "address": address,
        "lat": lat,
        "lng": lng,
        "units": s.units or settings.flyover_default_units,
        "google_maps_key": settings.google_maps_api_key,
        "has_weather": bool(settings.openweather_api_key),
    }


def set_location(db: Session, address: str) -> dict:
    try:
        hit = weather.geocode(address)
    except weather.WeatherNotConfigured as e:
        return {"ok": False, "reason": str(e)}
    if not hit:
        return {"ok": False, "reason": "Address not found"}
    s = get_or_create(db)
    s.address, s.lat, s.lng = hit["address"], hit["lat"], hit["lng"]
    s.updated_at = datetime.utcnow()
    db.commit(); db.refresh(s)
    return {"ok": True, "address": s.address, "lat": s.lat, "lng": s.lng}


def current_weather(db: Session, lat: float | None = None, lng: float | None = None) -> dict:
    s = get_or_create(db)
    _, def_lat, def_lng = _effective_location(s)
    la = lat if lat is not None else def_lat
    ln = lng if lng is not None else def_lng
    if la is None or ln is None:
        return {"available": False, "reason": "No location set"}
    try:
        return {"available": True, **weather.current(la, ln, s.units or "imperial")}
    except weather.WeatherNotConfigured as e:
        return {"available": False, "reason": str(e)}
    except httpx.HTTPStatusError as e:
        # Never echo the error's URL — it carries the appid (the API key).
        code = e.response.status_code
        hint = " — new OpenWeather keys take up to ~2h to activate" if code == 401 else ""
        return {"available": False, "reason": f"weather provider returned {code}{hint}"}
    except Exception:  # noqa: BLE001 — keep the key out of any error string
        return {"available": False, "reason": "weather lookup failed"}
