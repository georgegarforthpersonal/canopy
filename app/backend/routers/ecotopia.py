"""Ecotopia / Druid tracker endpoints (gated to the Cannwood org)."""

from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from clients.ecotopia import EcotopiaClient
from config import settings
from dependencies import get_current_organisation
from models import Organisation
from tracker_birds import BIRD_BY_OBJECT_ID, first_fix_for

CANNWOOD_SLUG = "cannwood"


def _require_cannwood(org: Organisation = Depends(get_current_organisation)) -> None:
    if org.slug != CANNWOOD_SLUG:
        raise HTTPException(status_code=404, detail="Not found")


# Gated to the Cannwood org (no admin auth — the tracking dashboard is public).
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
    track_colour: Optional[str] = None


class EcotopiaGpsFix(BaseModel):
    timestamp: str
    latitude: float
    longitude: float
    # Delivery stream: "gnss" = full-detail GNSS log (v2/gps), "satellite" =
    # Tianqi satellite-relayed UBILINK position (lon/lat only, lower confidence).
    source: str = "gnss"


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
        track_colour=bird.track_colour if bird else None,
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


def _iso(ts: Any) -> str:
    """Normalise a timestamp to ISO-UTC. The GNSS log already uses ISO strings;
    UBILINK location records use epoch milliseconds."""
    if isinstance(ts, (int, float)) and not isinstance(ts, bool):
        return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return str(ts)


def _merge_track(
    gnss: List[Dict[str, Any]], locations: List[Dict[str, Any]]
) -> List[EcotopiaGpsFix]:
    """Merge the GNSS log and the Tianqi satellite stream into one track, oldest
    first. Keyed by timestamp so a GNSS fix wins over a satellite position at the
    same instant (it carries quality metadata); both formats sort lexically as
    ISO-UTC strings."""
    by_ts: Dict[str, EcotopiaGpsFix] = {}
    for record, source in ((r, "satellite") for r in locations):
        if _valid_fix(record.get("longitude"), record.get("latitude")):
            ts = _iso(record["timestamp"])
            by_ts[ts] = EcotopiaGpsFix(
                timestamp=ts, latitude=record["latitude"], longitude=record["longitude"], source=source
            )
    for record in gnss:  # second, so GNSS overrides a satellite point at the same ts
        if _valid_fix(record.get("longitude"), record.get("latitude")):
            ts = _iso(record["timestamp"])
            by_ts[ts] = EcotopiaGpsFix(
                timestamp=ts, latitude=record["latitude"], longitude=record["longitude"], source="gnss"
            )
    return sorted(by_ts.values(), key=lambda f: f.timestamp)


def _fetch_track(
    client: EcotopiaClient, device_id: str, days: int
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Both position streams for a device (run together off the event loop)."""
    return client.get_gps_history(device_id, days), client.get_location_history(device_id, days)


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
    """Return a device's track over the last `days`, oldest first.

    Merges the two upstream position streams so the track stays current even when
    a bird is out of the GNSS log's uplink range: the v2 GNSS log (high-quality
    satellite fixes, source="gnss") and the Tianqi satellite-relayed UBILINK
    positions (source="satellite"), which are often the only recent points.
    """
    client = _client()
    try:
        gnss, locations = await run_in_threadpool(_fetch_track, client, device_id, days)
    except Exception as exc:  # noqa: BLE001 - surface upstream failures as 502
        raise HTTPException(status_code=502, detail=f"Ecotopia API error: {exc}") from exc

    track = _merge_track(gnss, locations)
    # Drop pre-release fixes (Norfolk rearing + Frome holding stop) so the track
    # starts at the bird's first real fix. Timestamps are ISO-UTC, so a lexical
    # compare matches the merge's own ordering.
    first_fix = first_fix_for(device_id)
    if first_fix:
        track = [f for f in track if f.timestamp >= first_fix]
    return track
