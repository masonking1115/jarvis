from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.db import Base
from backend.core.config import settings as app_settings
from backend.modules.flyover import service, weather as weather_mod
from backend.modules.flyover import weather
from backend.modules.flyover import geocode as geocode_mod
from backend.modules.flyover.models import get_or_create


def _session():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng)()


def test_normalize_current_maps_fields():
    raw = {
        "weather": [{"main": "Rain", "description": "light rain", "id": 500}],
        "main": {"temp": 56.3},
        "clouds": {"all": 90},
        "wind": {"speed": 4.1},
        "sys": {"sunrise": 1, "sunset": 10**12},
        "dt": 500,
    }
    out = weather.normalize_current(raw)
    assert out["main"] == "Rain"
    assert out["description"] == "light rain"
    assert round(out["temp"]) == 56
    assert out["clouds_pct"] == 90
    assert out["wind_mps"] == 4.1
    assert out["raw_id"] == 500
    assert out["is_day"] is True


def test_config_degrades_without_maps_key(monkeypatch):
    monkeypatch.setattr(app_settings, "google_maps_api_key", "")
    assert service.get_config(_session())["available"] is False


def test_config_exposes_maps_key_not_weather_key(monkeypatch):
    monkeypatch.setattr(app_settings, "google_maps_api_key", "MAPS123")
    monkeypatch.setattr(app_settings, "openweather_api_key", "WEATHER_SECRET")
    cfg = service.get_config(_session())
    assert cfg["google_maps_key"] == "MAPS123"
    assert cfg["has_weather"] is True
    assert "WEATHER_SECRET" not in str(cfg)   # weather key never leaks


def test_config_defaults_to_configured_location(monkeypatch):
    monkeypatch.setattr(app_settings, "google_maps_api_key", "MAPS123")
    cfg = service.get_config(_session())   # no location set -> default (Atherton)
    assert cfg["address"] == app_settings.flyover_default_address
    assert cfg["lat"] == app_settings.flyover_default_lat
    assert cfg["lng"] == app_settings.flyover_default_lng


def test_set_location_overrides_default(monkeypatch):
    monkeypatch.setattr(app_settings, "google_maps_api_key", "MAPS123")
    monkeypatch.setattr(geocode_mod, "geocode",
                        lambda a: {"address": "Reno, NV, US", "lat": 39.53, "lng": -119.81})
    db = _session()
    service.set_location(db, "Reno")
    cfg = service.get_config(db)
    assert cfg["address"] == "Reno, NV, US" and round(cfg["lat"], 1) == 39.5


def test_set_location_persists(monkeypatch):
    db = _session()
    monkeypatch.setattr(geocode_mod, "geocode",
                        lambda a: {"address": "Atherton, CA, US", "lat": 37.46, "lng": -122.2})
    r = service.set_location(db, "Atherton")
    assert r["ok"] and round(r["lat"], 1) == 37.5
    assert get_or_create(db).address == "Atherton, CA, US"


def test_set_location_not_found(monkeypatch):
    monkeypatch.setattr(geocode_mod, "geocode", lambda a: None)
    assert service.set_location(_session(), "zzz")["ok"] is False


def test_current_weather_without_key(monkeypatch):
    # A default location exists now, so unavailability comes from the missing key.
    monkeypatch.setattr(app_settings, "openweather_api_key", "")
    assert service.current_weather(_session())["available"] is False
