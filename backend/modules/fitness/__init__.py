"""Fitness module.

Tries to use real Garmin data via backend.modules.garmin.client when available.
Falls back to placeholder demo numbers so the dashboard still renders.

Replace this entirely once you have richer fitness sources (Strava, Apple Health).
"""
from fastapi import APIRouter

from backend.modules.garmin import client as gc

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


def _from_garmin() -> dict | None:
    """Return real Garmin data, or None if not available."""
    try:
        summary = gc.today_summary()
    except (gc.GarminNotConfigured, gc.GarminNotAuthenticated):
        return None
    except Exception:  # noqa: BLE001
        return None

    if not isinstance(summary, dict):
        return None

    steps          = int(summary.get("totalSteps") or 0)
    step_goal      = int(summary.get("dailyStepGoal") or 10000)
    active_min     = int(summary.get("activeSeconds", 0)) // 60 + int(summary.get("highlyActiveSeconds", 0)) // 60
    floors         = int(summary.get("floorsAscended") or 0)
    floors_goal    = int(summary.get("userFloorsAscendedGoal") or 10)
    distance_m     = float(summary.get("totalDistanceMeters") or 0)
    distance_mi    = round(distance_m / 1609.344, 2)

    # Body Battery (0-100) makes a great "wellness" surrogate. Falls back to a
    # computed score if unavailable.
    wellness = None
    try:
        bb = gc.body_battery()
        # Garmin returns a list; pick the most recent point.
        if isinstance(bb, list) and bb:
            latest = bb[-1]
            charged = latest.get("charged")
            if isinstance(charged, (int, float)):
                wellness = int(charged)
    except Exception:  # noqa: BLE001
        pass
    if wellness is None:
        wellness = min(100, int(70 + (steps / max(step_goal, 1)) * 20))

    return {
        "placeholder": False,
        "source": "garmin",
        "rings": [
            {"name": "Steps",    "value": steps,      "goal": step_goal,   "unit": "steps", "color": "#4ad6ff"},
            {"name": "Active",   "value": active_min, "goal": 60,          "unit": "min",   "color": "#22e8a0"},
            {"name": "Floors",   "value": floors,     "goal": max(floors_goal, 1), "unit": "fl", "color": "#ffb547"},
        ],
        "distance_mi": distance_mi,
        "wellness_pct": wellness,
    }


@router.get("/today")
def today():
    return _from_garmin() or _PLACEHOLDER
