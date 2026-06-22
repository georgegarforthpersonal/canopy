"""
Tests for the Ecotopia tracker router.

The external Ecotopia API is mocked — these cover the endpoints' mapping, the
missing-credentials guard, and the Cannwood-only org gate, not the live API.
"""

import pytest
from fastapi.testclient import TestClient

from clients.ecotopia import EcotopiaClient
from config import settings
from dependencies import get_current_organisation
from main import app
from models import Organisation

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


def _override_org(slug: str) -> None:
    async def _org() -> Organisation:
        return Organisation(name=slug, slug=slug, admin_password="", is_active=True)

    app.dependency_overrides[get_current_organisation] = _org


@pytest.fixture
def cannwood_client(client: TestClient, auth_headers: dict) -> TestClient:
    """The shared client overridden to the Cannwood org so requests pass the
    router's org gate. (The endpoints no longer require admin auth.)"""
    _override_org("cannwood")
    client.headers.update(auth_headers)
    return client


class TestGetEcotopiaDevices:
    """Tests for GET /api/ecotopia/devices"""

    def test_returns_flattened_devices(self, cannwood_client: TestClient, monkeypatch) -> None:
        """Maps the nested Ecotopia device into the flat response shape."""
        monkeypatch.setattr(settings, "ecotopia_username", "user")
        monkeypatch.setattr(settings, "ecotopia_password", "pass")
        monkeypatch.setattr(EcotopiaClient, "list_devices", lambda self: [SAMPLE_DEVICE])

        response = cannwood_client.get("/api/ecotopia/devices")

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
            "track_colour": "#6940A5",
        }

    def test_503_when_credentials_missing(self, cannwood_client: TestClient, monkeypatch) -> None:
        """Returns 503 rather than calling the API when creds are unset."""
        monkeypatch.setattr(settings, "ecotopia_username", "")
        monkeypatch.setattr(settings, "ecotopia_password", "")

        response = cannwood_client.get("/api/ecotopia/devices")

        assert response.status_code == 503

    def test_502_on_upstream_error(self, cannwood_client: TestClient, monkeypatch) -> None:
        """Surfaces upstream Ecotopia failures as a 502."""
        monkeypatch.setattr(settings, "ecotopia_username", "user")
        monkeypatch.setattr(settings, "ecotopia_password", "pass")

        def _boom(self) -> None:
            raise RuntimeError("login failed")

        monkeypatch.setattr(EcotopiaClient, "list_devices", _boom)

        response = cannwood_client.get("/api/ecotopia/devices")

        assert response.status_code == 502

    def test_404_for_non_cannwood_org(self, client: TestClient, auth_headers: dict) -> None:
        """Hidden (404) from non-Cannwood orgs (client fixture org is 'test-org')."""
        response = client.get("/api/ecotopia/devices", headers=auth_headers)
        assert response.status_code == 404

    def test_accessible_without_auth(self, client: TestClient, monkeypatch) -> None:
        """The Cannwood tracker endpoints are public — no admin auth required."""
        _override_org("cannwood")
        monkeypatch.setattr(settings, "ecotopia_username", "user")
        monkeypatch.setattr(settings, "ecotopia_password", "pass")
        monkeypatch.setattr(EcotopiaClient, "list_devices", lambda self: [SAMPLE_DEVICE])

        response = client.get("/api/ecotopia/devices")  # no auth headers

        assert response.status_code == 200


class TestGetDeviceGps:
    """Tests for GET /api/ecotopia/devices/{id}/gps"""

    def test_returns_only_valid_fixes(self, cannwood_client: TestClient, monkeypatch) -> None:
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
        monkeypatch.setattr(EcotopiaClient, "get_location_history", lambda self, device_id, days=7: [])

        response = cannwood_client.get("/api/ecotopia/devices/abc123/gps?days=7")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0] == {
            "timestamp": "2026-05-27T00:00:31Z",
            "latitude": 52.5834,
            "longitude": 1.0607,
            "source": "gnss",
        }
        assert data[1]["latitude"] == 51.2278

    def test_merges_satellite_stream_into_track(self, cannwood_client: TestClient, monkeypatch) -> None:
        """UBILINK Tianqi positions are merged in (epoch-ms -> ISO, tagged
        'satellite'), invalid ones dropped, a GNSS fix wins a timestamp tie, and
        the result is oldest-first."""
        monkeypatch.setattr(settings, "ecotopia_username", "user")
        monkeypatch.setattr(settings, "ecotopia_password", "pass")
        gnss = [
            {"timestamp": "2026-06-02T16:00:46Z", "latitude": 51.2277, "longitude": -2.3232},
        ]
        # epoch-ms: 2026-06-02T16:00:46Z = 1780416046000 (collides with the GNSS fix);
        # 2026-06-21T19:00:40Z = 1782068440000; plus a sentinel that must be dropped.
        locations = [
            {"timestamp": 1782068440000, "latitude": 51.1253, "longitude": -2.3819},
            {"timestamp": 1780416046000, "latitude": 99.9, "longitude": 99.9},  # same ts, but GNSS wins anyway
            {"timestamp": 1780000000000, "latitude": -99999.9, "longitude": -99999.9},  # sentinel -> dropped
        ]
        monkeypatch.setattr(EcotopiaClient, "get_gps_history", lambda self, device_id, days=7: gnss)
        monkeypatch.setattr(
            EcotopiaClient, "get_location_history", lambda self, device_id, days=7: locations
        )

        response = cannwood_client.get("/api/ecotopia/devices/abc123/gps?days=40")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2  # one merged (deduped) + one satellite; sentinel dropped
        assert data[0] == {
            "timestamp": "2026-06-02T16:00:46Z",
            "latitude": 51.2277,
            "longitude": -2.3232,
            "source": "gnss",  # GNSS wins the timestamp tie over the satellite point
        }
        assert data[1] == {
            "timestamp": "2026-06-21T19:00:40Z",
            "latitude": 51.1253,
            "longitude": -2.3819,
            "source": "satellite",
        }

    def test_drops_fixes_before_birds_first_fix(self, cannwood_client: TestClient, monkeypatch) -> None:
        """For a tracked bird, pre-release fixes (Norfolk rearing + the Frome
        holding stop) before its first_fix are dropped; the track starts there."""
        monkeypatch.setattr(settings, "ecotopia_username", "user")
        monkeypatch.setattr(settings, "ecotopia_password", "pass")
        # 240D's first_fix is 2026-06-04T14:00:26Z (see tracker_birds.py).
        gnss = [
            {"timestamp": "2026-05-27T08:00:40Z", "latitude": 52.5833, "longitude": 1.0608},  # Norfolk
            {"timestamp": "2026-06-02T12:00:22Z", "latitude": 51.2278, "longitude": -2.3233},  # Frome stop
            {"timestamp": "2026-06-04T14:00:26Z", "latitude": 51.1400, "longitude": -2.3772},  # first fix
            {"timestamp": "2026-06-05T10:00:37Z", "latitude": 51.1399, "longitude": -2.3772},  # after
        ]
        monkeypatch.setattr(EcotopiaClient, "get_gps_history", lambda self, device_id, days=7: gnss)
        monkeypatch.setattr(EcotopiaClient, "get_location_history", lambda self, device_id, days=7: [])

        response = cannwood_client.get("/api/ecotopia/devices/69c7b38f46109fd46939985a/gps?days=40")

        assert response.status_code == 200
        data = response.json()
        assert [f["timestamp"] for f in data] == ["2026-06-04T14:00:26Z", "2026-06-05T10:00:37Z"]

    def test_2408_first_fix_is_its_last_frome_fix(self, cannwood_client: TestClient, monkeypatch) -> None:
        """2408 stopped reporting at the Frome stop, so its first_fix is that last
        Frome fix — the track is the single point, with the earlier stop dropped."""
        monkeypatch.setattr(settings, "ecotopia_username", "user")
        monkeypatch.setattr(settings, "ecotopia_password", "pass")
        # 2408's first_fix is 2026-06-02T16:00:47Z (its final reported fix).
        gnss = [
            {"timestamp": "2026-06-02T12:00:07Z", "latitude": 51.2277, "longitude": -2.3232},  # earlier Frome
            {"timestamp": "2026-06-02T16:00:47Z", "latitude": 51.2277, "longitude": -2.3232},  # first fix
        ]
        monkeypatch.setattr(EcotopiaClient, "get_gps_history", lambda self, device_id, days=7: gnss)
        monkeypatch.setattr(EcotopiaClient, "get_location_history", lambda self, device_id, days=7: [])

        response = cannwood_client.get("/api/ecotopia/devices/69c7b38e46109fd4693995a1/gps?days=40")

        assert response.status_code == 200
        data = response.json()
        assert [f["timestamp"] for f in data] == ["2026-06-02T16:00:47Z"]

    def test_503_when_credentials_missing(self, cannwood_client: TestClient, monkeypatch) -> None:
        monkeypatch.setattr(settings, "ecotopia_username", "")
        monkeypatch.setattr(settings, "ecotopia_password", "")

        response = cannwood_client.get("/api/ecotopia/devices/abc123/gps")

        assert response.status_code == 503
