"""Diagnose the device-view vs track-view position split for an Ecotopia tracker.

WHY THE TRACK LOOKS SPARSE / STALE
----------------------------------
An Ecotopia (Druid UBILINK X1) tag produces positions that reach the platform
through two *different delivery channels*, exposed by two *different* endpoints:

  1. Full-detail GNSS log   -> GET v2/gps/device/{object_id}/page/
        Rich satellite fixes: used_star, dimension, hdop/vdop/pdop, quality,
        satellite[]. Uploaded only when the tag has a rich uplink. For a bird
        that migrates out of that uplink's range this stream simply STOPS
        (device 1300002402: last row 2026-06-02) even though the tag is alive.

  2. Tianqi satellite positions -> POST ubilink_x1/getLocationIDs
                                  + POST ubilink_x1/getLocationDetailByIDs
        Compact positions relayed over the Tianqi LEO satellite-IoT link
        (fields: tianqi_id, satellite_timestamp, message_id; lon/lat only --
        NO used_star/hdop/satellite metadata). This is current (device
        1300002402: through 2026-06-21) and is what the device card shows.

The app's "Track" calls ONLY endpoint #1, so it is missing every satellite-
relayed position -> the track lags reality and clusters at the last rich fix,
while the device card (latest of all sources) sits at the current location.

The device card's "latest" comes from device/getDetailByIDs ->
status_location.gps_position, whose `gps` sub-source is the last #1 fix and
whose `tianqi` sub-source is the last #2 position (used_star/dimension absent,
so status_gps reports them as 0).

Usage (creds come from ECOTOPIA_USERNAME / ECOTOPIA_PASSWORD in the environment,
exactly like the app -- nothing is hardcoded):

    PYTHONPATH=app/backend app/backend/venv/bin/python \
        app/backend/scripts/probe_ecotopia_fixes.py 1300002402 --days 40

The device argument matches by uuid (1300002402), Ecotopia ObjectId, or last-4
tag (2402). Pass --days to bound BOTH streams' history windows.
"""

from __future__ import annotations

import argparse
import math
import os
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from clients.ecotopia import EcotopiaClient

# Same env vars the app's config (config.settings.ecotopia_*) reads -- nothing hardcoded.
ECOTOPIA_USERNAME = os.environ.get("ECOTOPIA_USERNAME", "")
ECOTOPIA_PASSWORD = os.environ.get("ECOTOPIA_PASSWORD", "")


def num(v: Any) -> Optional[float]:
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def valid_fix(lon: Any, lat: Any) -> bool:
    """The exact rule the app's track view applies (routers/ecotopia._valid_fix)."""
    return (
        isinstance(lon, (int, float))
        and isinstance(lat, (int, float))
        and abs(lon) <= 180
        and abs(lat) <= 90
        and not (lon == 0 and lat == 0)
    )


def to_dt(ts: Any) -> Optional[datetime]:
    """Accept ISO strings (v2/gps) or epoch-ms ints (ubilink Location)."""
    if isinstance(ts, (int, float)) and not isinstance(ts, bool):
        return datetime.fromtimestamp(ts / 1000, timezone.utc)
    if isinstance(ts, str) and ts:
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    (lat1, lon1), (lat2, lon2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dlam = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def find_device(devices: List[Dict[str, Any]], key: str) -> Dict[str, Any]:
    for d in devices:
        if key in (d.get("id"), d.get("uuid")) or str(d.get("uuid", "")).endswith(key):
            return d
    raise SystemExit(f"Device {key!r} not found among {[d.get('uuid') for d in devices]}")


def fetch_ubilink_locations(client: EcotopiaClient, object_id: str, limit: int) -> List[Dict[str, Any]]:
    """Tianqi satellite-relayed positions (the stream the app's track ignores)."""
    if not client.token:
        client.login()
    ids = client._post(
        "ubilink_x1/getLocationIDs",
        {"page": {"limit": limit, "sort": ["-timestamp"]}, "device_id": object_id},
    ).get("ids", [])
    out: List[Dict[str, Any]] = []
    for i in range(0, len(ids), 200):
        out += client._post("ubilink_x1/getLocationDetailByIDs", {"ids": ids[i : i + 200]}).get(
            "locations", []
        )
    return out


def normalise(rec: Dict[str, Any], stream: str) -> Dict[str, Any]:
    lon, lat = rec.get("longitude"), rec.get("latitude")
    used = num(rec.get("used_star"))
    return {
        "dt": to_dt(rec.get("timestamp")),
        "lon": lon,
        "lat": lat,
        "valid": valid_fix(lon, lat),
        "stream": stream,
        "used_star": rec.get("used_star"),
        "hdop": rec.get("hdop"),
        "satellite": used is not None and used > 0,
    }


def summarise(name: str, pts: List[Dict[str, Any]], site: Tuple[Optional[float], Optional[float]]) -> None:
    v = [p for p in pts if p["valid"] and p["dt"]]
    print(f"\n  {name}: {len(pts)} rows, {len(v)} valid")
    if not v:
        return
    span = (min(p["dt"] for p in v), max(p["dt"] for p in v))
    print(f"    span: {span[0]:%Y-%m-%d %H:%M} -> {span[1]:%Y-%m-%d %H:%M} UTC")
    clusters = Counter((round(p["lat"], 2), round(p["lon"], 2)) for p in v)
    for (la, lo), n in clusters.most_common(5):
        d = haversine_km(site, (la, lo)) if None not in site else float("nan")
        print(f"    {la:.2f},{lo:.2f}  n={n:<4} {d:6.1f} km from device card")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("device", help="device uuid, Ecotopia ObjectId, or last-4 tag")
    ap.add_argument("--days", type=int, default=40, help="history window for both streams")
    args = ap.parse_args()

    if not ECOTOPIA_USERNAME or not ECOTOPIA_PASSWORD:
        raise SystemExit("Set ECOTOPIA_USERNAME / ECOTOPIA_PASSWORD in the environment.")

    client = EcotopiaClient(ECOTOPIA_USERNAME, ECOTOPIA_PASSWORD)
    dev = find_device(client.list_devices(), args.device)
    object_id = dev["id"]
    sl = dev.get("status_location") or {}
    site = (sl.get("latitude"), sl.get("longitude"))

    print("=" * 78)
    print(f"DEVICE {dev.get('uuid')}   model lookup via device/getDetailByIDs")
    print("=" * 78)
    print(f"  Device-card latest position : lon={sl.get('longitude')} lat={sl.get('latitude')} "
          f"@ {sl.get('timestamp')}")
    gp = sl.get("gps_position") or {}
    g, t = gp.get("gps") or {}, gp.get("tianqi") or {}
    if g:
        print(f"    last GNSS-log fix (gps)     : lon={g.get('longitude')} lat={g.get('latitude')} "
              f"used_star={g.get('used_star')} @ {g.get('timestamp')}")
    if t:
        print(f"    last Tianqi position        : lon={t.get('longitude')} lat={t.get('latitude')} "
              f"(no satellite metadata) @ {t.get('timestamp')}")

    gnss = [normalise(r, "gnss-log") for r in client.get_gps_history(object_id, days=args.days)]
    ubi = [normalise(r, "tianqi-sat") for r in fetch_ubilink_locations(client, object_id, limit=4000)]
    if args.days:
        cutoff = datetime.now(timezone.utc).timestamp() - args.days * 86400
        ubi = [p for p in ubi if p["dt"] and p["dt"].timestamp() >= cutoff]

    print("\n" + "=" * 78)
    print(f"TWO POSITION STREAMS  (last {args.days} days)")
    print("=" * 78)
    summarise("GNSS LOG    v2/gps/device/{id}/page/        <- the app's Track view", gnss, site)
    summarise("TIANQI SAT  ubilink_x1/getLocationDetailByIDs <- NOT read by the app", ubi, site)

    # Merged daily coverage: which stream has points on which day.
    days: Dict[str, Counter] = {}
    for p in gnss + ubi:
        if p["valid"] and p["dt"]:
            days.setdefault(f"{p['dt']:%Y-%m-%d}", Counter())[p["stream"]] += 1
    print("\n  Daily coverage (G = GNSS-log rows / T = Tianqi-sat rows):")
    for day in sorted(days):
        c = days[day]
        flag = "  <- only the satellite stream covers this day" if not c["gnss-log"] else ""
        print(f"    {day}  G={c['gnss-log']:<4} T={c['tianqi-sat']:<4}{flag}")

    print("\n" + "=" * 78)
    print("DIAGNOSIS")
    print("=" * 78)
    last_g = max((p["dt"] for p in gnss if p["valid"] and p["dt"]), default=None)
    last_t = max((p["dt"] for p in ubi if p["valid"] and p["dt"]), default=None)
    print(f"  Last GNSS-log fix (in app's Track): {last_g}")
    print(f"  Last Tianqi-sat position (card)   : {last_t}")
    print("  The app's Track reads ONLY the GNSS log, which has stopped while the bird is")
    print("  remote; the current positions arrive via the Tianqi satellite link and are")
    print("  only in ubilink_x1/getLocation* -> ingest that stream to complete the track.")
    print("  Tianqi positions carry no used_star/hdop; tag them lower-confidence on merge.")


if __name__ == "__main__":
    main()
