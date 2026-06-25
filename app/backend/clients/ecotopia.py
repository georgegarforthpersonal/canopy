"""Client for the undocumented Ecotopia/Druid tracker API (www.ecotopiago.com).

Login hashes the password as sha256("{username} + druid + {password} + heifeng").
Data calls carry the token in the JSON body; the v2 GPS API takes it in an
X-Druid-Authentication header instead. The token is reused across calls and
re-fetched once on an auth failure, so a long-lived instance can be cached.
"""

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import requests

from tracker_birds import TRACKER_OBJECT_IDS


class EcotopiaClient:
    BASE_URL = "https://www.ecotopiago.com/api"

    def __init__(self, username: str, password: str, timeout: int = 30):
        self.username = username
        self.password = password
        self.timeout = timeout
        self.session = requests.Session()
        self.token = ""

    def login(self) -> str:
        salted = f"{self.username} + druid + {self.password} + heifeng"
        response = self.session.post(
            f"{self.BASE_URL}/login",
            json={"username": self.username, "password": hashlib.sha256(salted.encode()).hexdigest()},
            timeout=self.timeout,
        )
        response.raise_for_status()
        token = response.json().get("token")
        if not token:
            raise RuntimeError("Ecotopia login failed (check username/password)")
        self.token = token
        return self.token

    def list_devices(self) -> List[Dict[str, Any]]:
        """Hydrate the hardcoded tracked device ObjectIds into full records."""
        devices: List[Dict[str, Any]] = self._post(
            "device/getDetailByIDs", {"ids": list(TRACKER_OBJECT_IDS)}
        )["devices"]
        return devices

    def get_gps_history(self, device_id: str, days: int = 7) -> List[Dict[str, Any]]:
        """GNSS records from the last `days`, oldest first (newest-first, 20/page upstream).

        NB: this endpoint currently ignores the `page` param for some devices and
        just re-serves the latest 20 rows, so we stop once a page stops advancing
        (oldest timestamp unchanged) rather than blindly fetching 100 duplicates.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        records: List[Dict[str, Any]] = []
        prev_oldest = None
        for page in range(1, 101):
            batch = self._get_v2(f"gps/device/{device_id}/page/", {"page": page})
            if not batch:
                break
            records.extend(batch)
            oldest = str(batch[-1].get("timestamp", ""))
            if oldest[:10] < cutoff or oldest == prev_oldest:  # past the window, or page didn't advance
                break
            prev_oldest = oldest
        recent = [r for r in records if str(r.get("timestamp", ""))[:10] >= cutoff]
        recent.sort(key=lambda r: r.get("timestamp", ""))
        return recent

    def get_location_history(self, device_id: str, days: int = 7) -> List[Dict[str, Any]]:
        """Tianqi satellite-relayed positions (ubilink_x1) from the last `days`.

        These reach the platform over the Tianqi LEO satellite-IoT link and carry
        only lon/lat (timestamps are epoch milliseconds; no GNSS quality fields).
        They are NOT in the v2/gps log and, for a bird out of the GNSS log's
        uplink range, are often the only current positions. IDs come newest-first,
        fetched in two steps (ids, then detail) like device/getDetailByIDs.
        """
        cutoff_ms = (datetime.now(timezone.utc) - timedelta(days=days)).timestamp() * 1000
        ids = self._post(
            "ubilink_x1/getLocationIDs",
            {"device_id": device_id, "page": {"limit": 5000, "sort": ["-timestamp"]}},
        ).get("ids", [])
        records: List[Dict[str, Any]] = []
        for start in range(0, len(ids), 200):
            batch = self._post(
                "ubilink_x1/getLocationDetailByIDs", {"ids": ids[start : start + 200]}
            ).get("locations", [])
            records.extend(batch)
            # IDs are newest-first, so once a batch dips before the cutoff, stop.
            if batch and min(r.get("timestamp", 0) for r in batch) < cutoff_ms:
                break
        return [r for r in records if r.get("timestamp", 0) >= cutoff_ms]

    def _get_v2(self, path: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        for attempt in range(2):
            if not self.token:
                self.login()
            response = self.session.get(
                f"{self.BASE_URL}/v2/{path}",
                headers={"X-Druid-Authentication": self.token},
                params=params,
                timeout=self.timeout,
            )
            if response.status_code == 401 and attempt == 0:
                self.token = ""  # expired — re-login and retry once
                continue
            response.raise_for_status()
            data: List[Dict[str, Any]] = response.json()
            return data
        raise RuntimeError(f"Ecotopia v2/{path} failed: authentication")

    def _post(self, path: str, data: Dict[str, Any]) -> Dict[str, Any]:
        for attempt in range(2):
            if not self.token:
                self.login()
            response = self.session.post(
                f"{self.BASE_URL}/{path}",
                json={"token": self.token, "data": data},
                timeout=self.timeout,
            )
            # The token can expire either as an HTTP 401 or an in-body code 401,
            # depending on the endpoint — re-login and retry once on either.
            if response.status_code == 401 and attempt == 0:
                self.token = ""
                continue
            response.raise_for_status()
            body = response.json()
            if body.get("code") == 401 and attempt == 0:
                self.token = ""  # expired — re-login and retry once
                continue
            if body.get("code") != 200:
                raise RuntimeError(f"Ecotopia {path} failed: {body}")
            payload: Dict[str, Any] = body["data"]
            return payload
        raise RuntimeError(f"Ecotopia {path} failed: authentication")
