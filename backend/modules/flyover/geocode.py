"""Address geocoding for Flyover.

Prefers Google's Geocoder (rooftop-accurate and aligned with the photoreal 3D
tiles) when the Maps key has the Geocoding API enabled. Falls back to
OpenWeather's city-level geocoder otherwise. Never lets the API key escape in
an error string.
"""
from __future__ import annotations

import httpx

from backend.core.config import settings
from . import weather

_GOOGLE = "https://maps.googleapis.com/maps/api/geocode/json"


def google_geocode(address: str) -> dict | None:
    """Rooftop-accurate geocode via Google. Returns None if the key is missing,
    the Geocoding API isn't enabled, or there's no match."""
    if not settings.google_maps_api_key:
        return None
    r = httpx.get(_GOOGLE, params={"address": address, "key": settings.google_maps_api_key}, timeout=15)
    r.raise_for_status()
    d = r.json()
    if d.get("status") != "OK" or not d.get("results"):
        return None
    res = d["results"][0]
    loc = res["geometry"]["location"]
    return {"address": res["formatted_address"], "lat": float(loc["lat"]), "lng": float(loc["lng"])}


def geocode(address: str) -> dict | None:
    """Google first (rooftop), then OpenWeather (city-level). Returns None if no
    geocoder can resolve the address."""
    try:
        g = google_geocode(address)
        if g:
            return g
    except Exception:  # noqa: BLE001 — Google not enabled / network: fall back quietly
        pass
    try:
        return weather.geocode(address)
    except weather.WeatherNotConfigured:
        return None
