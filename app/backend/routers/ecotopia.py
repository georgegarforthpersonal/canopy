"""Ecotopia / Druid tracker endpoints (gated to the Cannwood org)."""

from functools import lru_cache
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from clients.ecotopia import EcotopiaClient
from config import settings
from dependencies import get_current_organisation
from models import Organisation
from tracker_birds import BIRD_BY_OBJECT_ID

CANNWOOD_SLUG = "cannwood"


def _require_cannwood(org: Organisation = Depends(get_current_organisation)) -> None:
    if org.slug != CANNWOOD_SLUG:
        raise HTTPException(status_code=404, detail="Not found")


router = APIRouter(dependencies=[Depends(_require_cannwood)])


class EcotopiaDevice(BaseModel):
    id: str
    uuid: Optional[str] = None
    description: Optional[str] = None
    device_type: Optional[int] = None
    survive: Optional[int] = None
    battery_voltage: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    gps_timestamp: Optional[str] = None
    # From the hardcoded tracker -> bird mapping, not Ecotopia.
    sex: Optional[str] = None
    ring_number: Optional[str] = None
    ring_colour: Optional[str] = None


class EcotopiaGpsFix(BaseModel):
    timestamp: str
    latitude: float
    longitude: float


def _to_device(d: Dict[str, Any]) -> EcotopiaDevice:
    status_device = d.get("status_device") or {}
    status_gps = d.get("status_gps") or {}
    bird = BIRD_BY_OBJECT_ID.get(d["id"])
    return EcotopiaDevice(
        id=d["id"],
        uuid=d.get("uuid"),
        description=d.get("description"),
        device_type=d.get("device_type"),
        survive=d.get("survive"),
        battery_voltage=status_device.get("battery_voltage"),
        latitude=status_gps.get("latitude"),
        longitude=status_gps.get("longitude"),
        gps_timestamp=status_gps.get("timestamp"),
        sex=bird.sex if bird else None,
        ring_number=bird.ring_number if bird else None,
        ring_colour=bird.ring_colour if bird else None,
    )


@lru_cache(maxsize=1)
def _cached_client(username: str, password: str) -> EcotopiaClient:
    return EcotopiaClient(username, password)


def _client() -> EcotopiaClient:
    if not settings.ecotopia_username or not settings.ecotopia_password:
        raise HTTPException(status_code=503, detail="Ecotopia credentials not configured")
    return _cached_client(settings.ecotopia_username, settings.ecotopia_password)


def _valid_fix(lon: Any, lat: Any) -> bool:
    return (
        isinstance(lon, (int, float))
        and isinstance(lat, (int, float))
        and abs(lon) <= 180
        and abs(lat) <= 90
        and not (lon == 0 and lat == 0)
    )


@router.get("/devices", response_model=List[EcotopiaDevice])
async def get_devices() -> List[EcotopiaDevice]:
    """List the account's tracker devices from the Ecotopia API."""
    client = _client()
    try:
        devices = await run_in_threadpool(client.list_devices)
    except Exception as exc:  # noqa: BLE001 - surface upstream failures as 502
        raise HTTPException(status_code=502, detail=f"Ecotopia API error: {exc}") from exc

    return [_to_device(d) for d in devices]


@router.get("/devices/{device_id}/gps", response_model=List[EcotopiaGpsFix])
async def get_device_gps(device_id: str, days: int = 7) -> List[EcotopiaGpsFix]:
    """Return a device's successful GNSS fixes over the last `days`, oldest first."""
    client = _client()
    try:
        records = await run_in_threadpool(client.get_gps_history, device_id, days)
    except Exception as exc:  # noqa: BLE001 - surface upstream failures as 502
        raise HTTPException(status_code=502, detail=f"Ecotopia API error: {exc}") from exc

    return [
        EcotopiaGpsFix(timestamp=r["timestamp"], latitude=r["latitude"], longitude=r["longitude"])
        for r in records
        if _valid_fix(r.get("longitude"), r.get("latitude"))
    ]
