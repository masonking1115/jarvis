"""Trading Desk module — PLACEHOLDER.

Returns demo signals so the Trading Desk page can render. Real implementation
should connect to a broker / strategy engine.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/signals")
def signals():
    return {
        "placeholder": True,
        "signals": [
            {"ticker": "NVDA",  "side": "long",  "score": 0.81, "note": "Momentum breakout"},
            {"ticker": "AAPL",  "side": "watch", "score": 0.42, "note": "Range-bound"},
            {"ticker": "TSLA",  "side": "long",  "score": 0.67, "note": "Earnings tailwind"},
        ],
    }
