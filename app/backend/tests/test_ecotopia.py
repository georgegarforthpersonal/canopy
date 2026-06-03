"""
Tests for the Ecotopia tracker router (GET /api/ecotopia/devices).

The external Ecotopia API is mocked — these tests cover the endpoint's
mapping/flattening and the missing-credentials guard, not the live API.
"""

from fastapi.testclient import TestClient

from clients.ecotopia import EcotopiaClient
from config import settings

SAMPLE_DEVICE = {
    "id": "69c7b38f46109fd46939985a",  # tracker 240D (see tracker_birds.py)
    "uuid": "1300000d99",
    "description": "stored(Peter)",
    "device_type": 4864,
    "survive": 1,
    "status_device": {"battery_voltage": 3.941},
    "status_gps": {
        "latitude": 51.8051936,
        "longitude": 19.3248464,
        "timestamp": "2024-08-24T13:00:36Z",
    },
}


class TestGetEcotopiaDevices:
    """Tests for GET /api/ecotopia/devices"""

    def test_returns_flattened_devices(self, client: TestClient, monkeypatch) -> None:
        """Maps the nested Ecotopia device into the flat response shape."""
        monkeypatch.setattr(settings, "ecotopia_username", "user")
        monkeypatch.setattr(settings, "ecotopia_password", "pass")
        monkeypatch.setattr(EcotopiaClient, "list_devices", lambda self: [SAMPLE_DEVICE])

        response = client.get("/api/ecotopia/devices")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0] == {
            "id": "69c7b38f46109fd46939985a",
            "uuid": "1300000d99",
            "description": "stored(Peter)",
            "device_type": 4864,
            "survive": 1,
            "battery_voltage": 3.941,
            "latitude": 51.8051936,
            "longitude": 19.3248464,
            "gps_timestamp": "2024-08-24T13:00:36Z",
            # enriched from tracker_birds.py
            "sex": "male",
            "ring_number": "1847/1848",
            "ring_colour": "black",
        }

    def test_503_when_credentials_missing(self, client: TestClient, monkeypatch) -> None:
        """Returns 503 rather than calling the API when creds are unset."""
        monkeypatch.setattr(settings, "ecotopia_username", "")
        monkeypatch.setattr(settings, "ecotopia_password", "")

        response = client.get("/api/ecotopia/devices")

        assert response.status_code == 503

    def test_502_on_upstream_error(self, client: TestClient, monkeypatch) -> None:
        """Surfaces upstream Ecotopia failures as a 502."""
        monkeypatch.setattr(settings, "ecotopia_username", "user")
        monkeypatch.setattr(settings, "ecotopia_password", "pass")

        def _boom(self) -> None:
            raise RuntimeError("login failed")

        monkeypatch.setattr(EcotopiaClient, "list_devices", _boom)

        response = client.get("/api/ecotopia/devices")

        assert response.status_code == 502


class TestGetDeviceGps:
    """Tests for GET /api/ecotopia/devices/{id}/gps"""

    def test_returns_only_valid_fixes(self, client: TestClient, monkeypatch) -> None:
        """Drops failed-fix records (null / sentinel coords), keeps real ones."""
        monkeypatch.setattr(settings, "ecotopia_username", "user")
        monkeypatch.setattr(settings, "ecotopia_password", "pass")
        records = [
            {"timestamp": "2026-05-27T00:00:31Z", "latitude": 52.5834, "longitude": 1.0607},
            {"timestamp": "2026-05-27T10:00:25Z", "latitude": None, "longitude": None},
            {"timestamp": "2026-05-27T12:00:24Z", "latitude": -99999.9, "longitude": -99999.9},
            {"timestamp": "2026-06-02T12:00:22Z", "latitude": 51.2278, "longitude": -2.3233},
        ]
        monkeypatch.setattr(EcotopiaClient, "get_gps_history", lambda self, device_id, days=7: records)

        response = client.get("/api/ecotopia/devices/abc123/gps?days=7")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0] == {"timestamp": "2026-05-27T00:00:31Z", "latitude": 52.5834, "longitude": 1.0607}
        assert data[1]["latitude"] == 51.2278

    def test_503_when_credentials_missing(self, client: TestClient, monkeypatch) -> None:
        monkeypatch.setattr(settings, "ecotopia_username", "")
        monkeypatch.setattr(settings, "ecotopia_password", "")

        response = client.get("/api/ecotopia/devices/abc123/gps")

        assert response.status_code == 503
