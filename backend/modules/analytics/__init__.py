"""Analytics module — PLACEHOLDER.

Returns demo time-series for the dashboard charts.
Replace with real metrics from the Metrics & Optimization Engine.
"""
import math
import random
from fastapi import APIRouter

router = APIRouter()


def _series(seed: int, n: int = 24, base: float = 70.0, amp: float = 15.0) -> list[float]:
    random.seed(seed)
    return [round(base + amp * math.sin(i / 3.0) + random.uniform(-4, 4), 1) for i in range(n)]


@router.get("/overview")
def overview():
    return {
        "placeholder": True,
        "metrics": [
            {"name": "Productivity", "value": 88, "unit": "score", "color": "#22d3ee", "series": _series(1, base=82, amp=10)},
            {"name": "Body Battery", "value": 65, "unit": "%",     "color": "#34d399", "series": _series(2, base=60, amp=18)},
            {"name": "VO2 Max",      "value": 52, "unit": "ml/kg", "color": "#fbbf24", "series": _series(3, base=50, amp=4)},
        ],
        "net_worth_series": [round(240000 + 800 * i + random.uniform(-1500, 1500), 0) for i in range(30)],
    }
