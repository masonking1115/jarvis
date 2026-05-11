"""Fitness module — PLACEHOLDER.

Returns demo Garmin/Strava-style metrics so the dashboard can render.
Replace with real Garmin Connect / Strava integration in Phase 3.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/today")
def today():
    return {
        "placeholder": True,
        "rings": [
            {"name": "Move",  "value": 542,  "goal": 700,  "unit": "cal",   "color": "#22d3ee"},
            {"name": "Exercise", "value": 38, "goal": 60,  "unit": "min",  "color": "#34d399"},
            {"name": "Stand", "value": 9,    "goal": 12,   "unit": "hr",    "color": "#fbbf24"},
        ],
        "distance_mi": 8.42,
        "wellness_pct": 82,
        "source": "strava-stub",
    }
