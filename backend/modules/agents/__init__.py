"""Agents module — PLACEHOLDER.

Returns the roster of AI agents from the project roadmap. Real implementation
will report each agent's runtime status and last-action timestamp.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("")
def list_agents():
    return {
        "placeholder": True,
        "agents": [
            {"name": "Scheduler Agent",     "status": "online", "role": "Time optimization"},
            {"name": "Finance Agent",       "status": "online", "role": "Budgeting / investing"},
            {"name": "Health Agent",        "status": "ready",  "role": "Fitness / recovery"},
            {"name": "Trading Agent",       "status": "warn",   "role": "Market analysis"},
            {"name": "Research Agent",      "status": "ready",  "role": "Engineering research"},
            {"name": "Accountability Agent","status": "online", "role": "Goal enforcement"},
        ],
    }
