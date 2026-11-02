"""The living world's shared state (docs/LIVING_WORLD.md): the weather outside and how the world is shown to one user.

Weather is read from a provider once per map cell and cached in `weather_cache`, so one phone or a thousand in the same
town cost the same single read. Coordinates are rounded to 0.1 degree (about 11 km) before anything else happens to
them: the rounded cell is all that is stored or sent on, it is never linked to a user, and it is never logged. When the
provider can't answer, a recent reading is returned marked `stale`, and after that `available: false`: the app then shows
the time of day only and doesn't pretend to know the weather.

The backend keeps business state only. No animation frame or position is stored: the app renders from this state.
"""
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .errors import APIError
from .models import User, WeatherCache, WorldPreference, as_utc, utcnow
from .ratelimit import enforce
from .security import current_user

log = logging.getLogger("refmi.world")
router = APIRouter(prefix="/api/world", tags=["world"])

SOURCE = "Open-Meteo"
# From this wind speed (km/h) on, leaves and grass move harder: "fresh breeze" on the Beaufort scale.
WINDY_KMH = 29
# Cells not read for this long are removed; the table never grows past the places in use.
PRUNE_AFTER = timedelta(days=7)

CONDITIONS: dict[int, str] = {0: "clear", 1: "clear", 2: "cloudy", 3: "cloudy", 45: "fog", 48: "fog",
                              **{c: "rain" for c in (51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82)},
                              **{c: "snow" for c in (71, 73, 75, 77, 85, 86)},
                              **{c: "storm" for c in (95, 96, 99)}}


def cell_of(lat: float, lon: float) -> tuple[str, float, float]:
    """The map cell around a point: its key and its rounded coordinates (0.0 for -0.0, so one place has one key)."""
    la, lo = round(lat, 1) + 0.0, round(lon, 1) + 0.0
    return f"{la:.1f},{lo:.1f}", la, lo


def fetch_current(lat: float, lon: float) -> dict:
    """Asks the provider for the weather now. Raises on anything but a complete, known answer (OSError, ValueError or
    KeyError): a reading it doesn't understand is no reading."""
    query = urllib.parse.urlencode({"latitude": lat, "longitude": lon, "timezone": "UTC", "wind_speed_unit": "kmh",
                                    "current": "temperature_2m,weather_code,cloud_cover,wind_speed_10m,is_day"})
    with urllib.request.urlopen(f"{settings.weather_api_url}?{query}", timeout=settings.weather_timeout_seconds) as reply:
        current = json.loads(reply.read())["current"]
    return {"condition": CONDITIONS[int(current["weather_code"])], "temperature_c": round(float(current["temperature_2m"])),
            "wind_kmh": round(float(current["wind_speed_10m"])), "cloud_cover": int(current["cloud_cover"]),
            "is_day": bool(current["is_day"]), "observed_at": str(current["time"])}


def _view(row: WeatherCache, now) -> dict:
    if not row.payload or row.fetched_at is None or as_utc(row.fetched_at) < now - timedelta(hours=settings.weather_stale_hours):
        return {"available": False}
    reading = json.loads(row.payload)
    fetched = as_utc(row.fetched_at)
    return {**reading, "available": True, "windy": reading["wind_kmh"] >= WINDY_KMH, "source": SOURCE,
            "fetched_at": fetched.isoformat(), "expires_at": as_utc(row.expires_at).isoformat(),
            "stale": fetched < now - timedelta(minutes=settings.weather_ttl_minutes)}


def weather_at(db: Session, lat: float, lon: float) -> dict:
    cell, la, lo = cell_of(lat, lon)
    now = utcnow()
    row = db.get(WeatherCache, cell)
    if row is not None and as_utc(row.expires_at) > now:
        return _view(row, now)
    if not settings.weather_enabled:
        return {"available": False}
    payload, fetched_at = (row.payload, row.fetched_at) if row is not None else (None, None)
    db.rollback()  # no transaction stays open during the call
    try:
        payload, fetched_at = json.dumps(fetch_current(la, lo)), now
        expires_at = now + timedelta(minutes=settings.weather_ttl_minutes)
    except (OSError, ValueError, KeyError, TypeError) as error:
        log.warning("weather provider unavailable: %s", type(error).__name__)
        # Not asked again for a little while, however many phones are waiting; what was read before stays.
        expires_at = now + timedelta(minutes=settings.weather_retry_minutes)
    row = db.get(WeatherCache, cell)
    if row is None:
        row = WeatherCache(cell=cell)
        db.add(row)
    row.payload, row.fetched_at, row.expires_at = payload, fetched_at, expires_at
    db.execute(delete(WeatherCache).where(WeatherCache.expires_at < now - PRUNE_AFTER))
    try:
        db.commit()
    except IntegrityError:  # another request filled this cell just now: its reading is as good
        db.rollback()
        row = db.get(WeatherCache, cell)
    return _view(row, utcnow())


@router.get("/weather")
def weather(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The weather around a point, or `{"available": false}`. Never an error for a provider problem: it isn't the
    user's, and the world simply goes on by the clock."""
    enforce("world_weather", settings.rate_limit_world_weather, str(user.id))
    return weather_at(db, lat, lon)


# ---------------------------------------------------------------------------- how the world is shown
class WorldSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sound: bool | None = None
    effects: bool | None = None
    # "auto" follows the device (its reduce-motion setting, how fast it runs); "reduced" stays calm on this account.
    motion: Literal["auto", "reduced"] = "auto"
    # Lamps the user switched by hand, as placement keys of the room (items' uids), and what they chose.
    lamps: dict[str, bool] = Field(default_factory=dict, max_length=64)


class PreferencesInput(BaseModel):
    version: int = Field(ge=0)
    settings: WorldSettings


def _preferences_view(row: WorldPreference | None) -> dict:
    if row is None:
        return {"version": 0, "settings": WorldSettings().model_dump()}
    return {"version": row.version, "settings": WorldSettings(**json.loads(row.settings_json)).model_dump()}


@router.get("/preferences")
def get_preferences(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _preferences_view(db.get(WorldPreference, user.id))


@router.put("/preferences")
def put_preferences(data: PreferencesInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Saves the settings if `version` is still the latest (0 for the first save); else 409 with nothing changed, so a
    late or outdated save can't overwrite a newer one."""
    text = data.settings.model_dump_json()
    conflict = APIError(409, "preferences_version_conflict", "These settings were changed somewhere else")
    if data.version == 0:
        db.add(WorldPreference(user_id=user.id, settings_json=text, version=1))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise conflict from None
    else:
        changed = db.execute(update(WorldPreference).where(WorldPreference.user_id == user.id, WorldPreference.version == data.version)
                             .values(settings_json=text, version=data.version + 1, updated_at=utcnow())
                             .execution_options(synchronize_session=False))
        if changed.rowcount != 1:
            db.rollback()
            raise conflict
        db.commit()
    return _preferences_view(db.get(WorldPreference, user.id))
