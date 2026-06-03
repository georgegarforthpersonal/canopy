"""Client for the undocumented Ecotopia/Druid tracker API (www.ecotopiago.com).

Login hashes the password as sha256("{username} + druid + {password} + heifeng").
Data calls carry the token in the JSON body; the v2 GPS API takes it in an
X-Druid-Authentication header instead.
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
        """GNSS records from the last `days`, oldest first (newest-first, 20/page upstream)."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        records: List[Dict[str, Any]] = []
        for page in range(1, 101):
            batch = self._get_v2(f"gps/device/{device_id}/page/", {"page": page})
            if not batch:
                break
            records.extend(batch)
            if str(batch[-1].get("timestamp", ""))[:10] < cutoff:
                break
        recent = [r for r in records if str(r.get("timestamp", ""))[:10] >= cutoff]
        recent.sort(key=lambda r: r.get("timestamp", ""))
        return recent

    def _get_v2(self, path: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not self.token:
            self.login()
        response = self.session.get(
            f"{self.BASE_URL}/v2/{path}",
            headers={"X-Druid-Authentication": self.token},
            params=params,
            timeout=self.timeout,
        )
        response.raise_for_status()
        body = response.json()
        return body if isinstance(body, list) else []

    def _post(self, path: str, data: Dict[str, Any]) -> Dict[str, Any]:
        if not self.token:
            self.login()
        response = self.session.post(
            f"{self.BASE_URL}/{path}",
            json={"token": self.token, "data": data},
            timeout=self.timeout,
        )
        response.raise_for_status()
        body = response.json()
        if body.get("code") != 200:
            raise RuntimeError(f"Ecotopia {path} failed: {body}")
        payload: Dict[str, Any] = body["data"]
        return payload
