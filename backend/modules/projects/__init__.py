"""Projects module — PLACEHOLDER.

Returns demo engineering projects. Replace with a real DB-backed module
once the Project & Research Management System (Phase 1, Module 8) is built.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("")
def list_projects():
    return {
        "placeholder": True,
        "projects": [
            {"name": "Tesla AI Side-Build",    "status": "active",  "progress": 0.42},
            {"name": "Glide Slope Receiver",   "status": "active",  "progress": 0.68},
            {"name": "AGC System",             "status": "paused",  "progress": 0.20},
            {"name": "FPGA SDR Research",      "status": "active",  "progress": 0.55},
        ],
    }
