"""
Tests for Devices Router

Tests CRUD operations for the /api/devices endpoints.
"""

from fastapi.testclient import TestClient


class TestGetDevices:
    """Tests for GET /api/devices"""

    def test_get_devices_empty(self, client: TestClient, auth_headers: dict):
        """Should return empty list when no devices exist."""
        response = client.get("/api/devices", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []

    def test_get_devices_returns_list(
        self, client: TestClient, auth_headers: dict, create_device
    ):
        """Should return list of devices."""
        create_device(device_id="DEV001", name="Device 1")
        create_device(device_id="DEV002", name="Device 2")

        response = client.get("/api/devices", headers=auth_headers)
        assert response.status_code == 200
        assert len(response.json()) == 2

    def test_get_devices_excludes_inactive(
        self, client: TestClient, auth_headers: dict, create_device
    ):
        """Should exclude inactive devices by default."""
        create_device(device_id="ACTIVE", is_active=True)
        create_device(device_id="INACTIVE", is_active=False)

        response = client.get("/api/devices", headers=auth_headers)
        assert response.status_code == 200
        assert len(response.json()) == 1

    def test_get_devices_filter_by_type(
        self, client: TestClient, auth_headers: dict, create_device
    ):
        """Should filter devices by type."""
        from models import DeviceType
        create_device(device_id="AUDIO", device_type=DeviceType.audio_recorder)
        create_device(device_id="CAMERA", device_type=DeviceType.camera_trap)

        response = client.get(
            "/api/devices?device_type=audio_recorder", headers=auth_headers
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 1
        assert data[0]["device_id"] == "AUDIO"


class TestGetDeviceById:
    """Tests for GET /api/devices/{id}"""

    def test_get_device_by_id(
        self, client: TestClient, auth_headers: dict, create_device
    ):
        """Should return device by ID."""
        device = create_device(device_id="TEST123", name="Test Device")

        response = client.get(f"/api/devices/{device.id}", headers=auth_headers)
        assert response.status_code == 200

        data = response.json()
        assert data["device_id"] == "TEST123"
        assert data["name"] == "Test Device"

    def test_get_device_not_found(self, client: TestClient, auth_headers: dict):
        """Should return 404 for non-existent device."""
        response = client.get("/api/devices/99999", headers=auth_headers)
        assert response.status_code == 404


class TestGetDeviceByDeviceId:
    """Tests for GET /api/devices/by-device-id/{device_id}"""

    def test_get_device_by_serial(
        self, client: TestClient, auth_headers: dict, create_device
    ):
        """Should find device by serial number."""
        create_device(device_id="SERIAL123", name="My Device")

        response = client.get(
            "/api/devices/by-device-id/SERIAL123", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["name"] == "My Device"

    def test_get_device_by_serial_not_found(
        self, client: TestClient, auth_headers: dict
    ):
        """Should return 404 for non-existent serial."""
        response = client.get(
            "/api/devices/by-device-id/NOTEXIST", headers=auth_headers
        )
        assert response.status_code == 404


class TestCreateDevice:
    """Tests for POST /api/devices"""

    def test_create_device(self, client: TestClient, auth_headers: dict):
        """Should create a new device."""
        response = client.post(
            "/api/devices",
            json={
                "device_id": "NEW001",
                "name": "New Device",
                "device_type": "audio_recorder",
                "latitude": 51.5,
                "longitude": -0.12,
            },
            headers=auth_headers,
        )
        assert response.status_code == 201

        data = response.json()
        assert data["device_id"] == "NEW001"
        assert data["name"] == "New Device"
        assert data["latitude"] == 51.5
        assert data["longitude"] == -0.12

    def test_create_device_duplicate(
        self, client: TestClient, auth_headers: dict, create_device
    ):
        """Should return 409 for duplicate device_id."""
        create_device(device_id="DUPE001")

        response = client.post(
            "/api/devices",
            json={
                "device_id": "DUPE001",
                "name": "Duplicate",
                "device_type": "audio_recorder",
                "latitude": 51.5,
                "longitude": -0.12,
            },
            headers=auth_headers,
        )
        assert response.status_code == 409

    def test_create_device_requires_coordinates(
        self, client: TestClient, auth_headers: dict
    ):
        """Should return 422 when latitude/longitude are missing."""
        response = client.post(
            "/api/devices",
            json={"device_id": "NOCOORDS", "name": "No Coords", "device_type": "audio_recorder"},
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_create_device_requires_name(
        self, client: TestClient, auth_headers: dict
    ):
        """Should return 422 when name is missing."""
        response = client.post(
            "/api/devices",
            json={
                "device_id": "NONAME",
                "device_type": "audio_recorder",
                "latitude": 51.5,
                "longitude": -0.12,
            },
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_create_device_unauthorized(self, client: TestClient):
        """Should return 401 without authentication."""
        response = client.post(
            "/api/devices",
            json={
                "device_id": "TEST",
                "name": "Test",
                "device_type": "audio_recorder",
                "latitude": 51.5,
                "longitude": -0.12,
            },
        )
        assert response.status_code == 401


class TestDeleteDevice:
    """Tests for DELETE /api/devices/{id}"""

    def test_delete_device(
        self, client: TestClient, auth_headers: dict, create_device
    ):
        """Should hard delete device."""
        device = create_device(device_id="TODELETE")

        response = client.delete(f"/api/devices/{device.id}", headers=auth_headers)
        assert response.status_code == 204

        # Verify deleted
        get_response = client.get(f"/api/devices/{device.id}", headers=auth_headers)
        assert get_response.status_code == 404


class TestDeactivateDevice:
    """Tests for POST /api/devices/{id}/deactivate"""

    def test_deactivate_device(
        self, client: TestClient, auth_headers: dict, create_device
    ):
        """Should deactivate device."""
        device = create_device(device_id="ACTIVE", is_active=True)

        response = client.post(
            f"/api/devices/{device.id}/deactivate", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["is_active"] is False

    def test_deactivate_already_inactive(
        self, client: TestClient, auth_headers: dict, create_device
    ):
        """Should return 400 when already inactive."""
        device = create_device(device_id="INACTIVE", is_active=False)

        response = client.post(
            f"/api/devices/{device.id}/deactivate", headers=auth_headers
        )
        assert response.status_code == 400


class TestReactivateDevice:
    """Tests for POST /api/devices/{id}/reactivate"""

    def test_reactivate_device(
        self, client: TestClient, auth_headers: dict, create_device
    ):
        """Should reactivate device."""
        device = create_device(device_id="INACTIVE", is_active=False)

        response = client.post(
            f"/api/devices/{device.id}/reactivate", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["is_active"] is True
