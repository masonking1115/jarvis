"""Flyover endpoints (/api/flyover). Degrade with available=false + HTTP 200."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from . import service

router = APIRouter()


@router.get("/config")
def config(db: Session = Depends(get_db)):
    return service.get_config(db)


@router.get("/weather")
def weather_now(lat: float | None = None, lng: float | None = None, db: Session = Depends(get_db)):
    return service.current_weather(db, lat, lng)


@router.get("/reverse")
def reverse(lat: float, lng: float):
    return service.reverse_geocode(lat, lng)


class LocationIn(BaseModel):
    address: str


@router.post("/location")
def set_location(body: LocationIn, db: Session = Depends(get_db)):
    return service.set_location(db, body.address)
