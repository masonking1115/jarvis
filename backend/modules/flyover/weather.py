"""OpenWeather client for Flyover: geocoding + current conditions.

The OpenWeather API key stays server-side; only normalized results are
returned to the client. Uses httpx (same as the gmail client).
"""
from __future__ import annotations

import httpx

from backend.core.config import settings

_GEO = "https://api.openweathermap.org/geo/1.0/direct"
_CURRENT = "https://api.openweathermap.org/data/2.5/weather"


class WeatherNotConfigured(Exception):
    """No OpenWeather API key set."""


def _key() -> str:
    if not settings.openweather_api_key:
        raise WeatherNotConfigured("Set OPENWEATHER_API_KEY in backend/.env")
    return settings.openweather_api_key


def geocode(address: str) -> dict | None:
    """Address -> {address, lat, lng} or None if not found."""
    r = httpx.get(_GEO, params={"q": address, "limit": 1, "appid": _key()}, timeout=15)
    r.raise_for_status()
    hits = r.json()
    if not hits:
        return None
    h = hits[0]
    label = ", ".join(p for p in [h.get("name"), h.get("state"), h.get("country")] if p)
    return {"address": label or address, "lat": float(h["lat"]), "lng": float(h["lon"])}


def normalize_current(raw: dict) -> dict:
    w = (raw.get("weather") or [{}])[0]
    sys = raw.get("sys") or {}
    dt = raw.get("dt")
    sunrise, sunset = sys.get("sunrise"), sys.get("sunset")
    is_day = True
    if dt is not None and sunrise is not None and sunset is not None:
        is_day = sunrise <= dt <= sunset
    return {
        "main": w.get("main", "Clear"),
        "description": w.get("description", ""),
        "temp": raw.get("main", {}).get("temp"),
        "clouds_pct": raw.get("clouds", {}).get("all", 0),
        "wind_mps": raw.get("wind", {}).get("speed", 0.0),
        "raw_id": w.get("id"),
        "is_day": is_day,
        "dt": dt,                 # current unix time at the location (UTC)
        "sunrise": sunrise,       # unix (UTC)
        "sunset": sunset,         # unix (UTC)
    }


def current(lat: float, lng: float, units: str = "imperial") -> dict:
    r = httpx.get(_CURRENT, params={"lat": lat, "lon": lng, "appid": _key(), "units": units}, timeout=15)
    r.raise_for_status()
    return normalize_current(r.json())
