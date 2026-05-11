"""Notes module — PLACEHOLDER.

Stubbed for the Notes sidebar entry. Replace with a DB-backed notes table
when needed.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("")
def list_notes():
    return {"placeholder": True, "notes": []}
