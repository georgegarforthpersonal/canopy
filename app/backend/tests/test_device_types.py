"""
Tests for Device Types Router

Tests the device type registry endpoints under /api/device-types: listing system +
custom types, creating/updating/deactivating custom types, and protection of the
built-in system types.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import Organisation, DeviceTypeRegistry, DeviceType


def _make_other_org(db_session: Session) -> Organisation:
    org = Organisation(
        name="Other Org", slug="other-org", admin_password="pw", is_active=True
    )
    db_session.add(org)
    db_session.commit()
    db_session.refresh(org)
    return org


class TestGetDeviceTypes:
    """Tests for GET /api/device-types"""

    def test_returns_system_types_for_fresh_org(self, client: TestClient, auth_headers: dict):
        """A fresh org sees exactly the three built-in system types."""
        response = client.get("/api/device-types", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        slugs = {t["slug"] for t in data}
        assert slugs == {"audio_recorder", "camera_trap", "refugia"}
        assert all(t["is_system"] for t in data)

    def test_returns_system_plus_org_custom(
        self, client: TestClient, auth_headers: dict, create_device_type
    ):
        """Org custom types are listed alongside the system types."""
        create_device_type(slug="bat_detector", display_name="Bat Detector")

        response = client.get("/api/device-types", headers=auth_headers)
        assert response.status_code == 200
        slugs = {t["slug"] for t in response.json()}
        assert "bat_detector" in slugs
        assert {"audio_recorder", "camera_trap", "refugia"}.issubset(slugs)

    def test_excludes_other_orgs_custom_types(
        self, client: TestClient, auth_headers: dict, db_session: Session
    ):
        """Another org's custom type must not be visible."""
        other = _make_other_org(db_session)
        db_session.add(
            DeviceTypeRegistry(
                slug="foreign_type", display_name="Foreign", icon_key="sensor",
                color="#000000", organisation_id=other.id, is_system=False, is_active=True,
            )
        )
        db_session.commit()

        response = client.get("/api/device-types", headers=auth_headers)
        slugs = {t["slug"] for t in response.json()}
        assert "foreign_type" not in slugs

    def test_excludes_inactive_by_default(
        self, client: TestClient, auth_headers: dict, create_device_type
    ):
        """Inactive custom types are hidden unless include_inactive is set."""
        create_device_type(slug="retired", display_name="Retired", is_active=False)

        active = client.get("/api/device-types", headers=auth_headers)
        assert "retired" not in {t["slug"] for t in active.json()}

        inactive = client.get("/api/device-types?include_inactive=true", headers=auth_headers)
        assert "retired" in {t["slug"] for t in inactive.json()}


class TestCreateDeviceType:
    """Tests for POST /api/device-types"""

    def test_create_custom_type(self, client: TestClient, auth_headers: dict):
        """Should create a custom type with a server-derived slug."""
        response = client.post(
            "/api/device-types",
            json={"display_name": "Weather Station", "icon_key": "sensor", "color": "#6940A5"},
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["slug"] == "weather_station"
        assert data["display_name"] == "Weather Station"
        assert data["is_system"] is False
        assert data["is_active"] is True
        assert data["organisation_id"] is not None

    def test_create_duplicate_slug_conflicts(
        self, client: TestClient, auth_headers: dict, create_device_type
    ):
        """A second type slugifying to an existing org slug returns 409."""
        create_device_type(slug="bat_detector", display_name="Bat Detector")
        response = client.post(
            "/api/device-types",
            json={"display_name": "Bat Detector", "icon_key": "sensor", "color": "#111111"},
            headers=auth_headers,
        )
        assert response.status_code == 409

    def test_create_collision_with_system_slug_conflicts(
        self, client: TestClient, auth_headers: dict
    ):
        """A custom type colliding with a system slug returns 409."""
        response = client.post(
            "/api/device-types",
            json={"display_name": "Camera Trap", "icon_key": "camera", "color": "#222222"},
            headers=auth_headers,
        )
        assert response.status_code == 409

    def test_create_blank_name_rejected(self, client: TestClient, auth_headers: dict):
        """A name with no alphanumerics yields an empty slug and is rejected."""
        response = client.post(
            "/api/device-types",
            json={"display_name": "!!!", "icon_key": "sensor", "color": "#333333"},
            headers=auth_headers,
        )
        assert response.status_code == 400

    def test_create_requires_admin(self, client: TestClient):
        """Should return 401 without authentication."""
        response = client.post(
            "/api/device-types",
            json={"display_name": "Nope", "icon_key": "sensor", "color": "#444444"},
        )
        assert response.status_code == 401


class TestUpdateDeviceType:
    """Tests for PUT /api/device-types/{id}"""

    def test_update_custom_type(
        self, client: TestClient, auth_headers: dict, create_device_type
    ):
        """Should update display name, icon and colour."""
        dt = create_device_type(slug="bat_detector", display_name="Bat Detector")
        response = client.put(
            f"/api/device-types/{dt.id}",
            json={"display_name": "Bat Box", "color": "#ABCDEF"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["display_name"] == "Bat Box"
        assert data["color"] == "#ABCDEF"
        assert data["slug"] == "bat_detector"  # slug is immutable

    def test_update_system_type_forbidden(
        self, client: TestClient, auth_headers: dict, db_session: Session
    ):
        """System types cannot be modified (403)."""
        system = (
            db_session.query(DeviceTypeRegistry)
            .filter(DeviceTypeRegistry.slug == "camera_trap")
            .first()
        )
        response = client.put(
            f"/api/device-types/{system.id}",
            json={"display_name": "Hacked"},
            headers=auth_headers,
        )
        assert response.status_code == 403

    def test_update_other_org_type_not_found(
        self, client: TestClient, auth_headers: dict, db_session: Session
    ):
        """Updating another org's type returns 404."""
        other = _make_other_org(db_session)
        foreign = DeviceTypeRegistry(
            slug="foreign", display_name="Foreign", icon_key="sensor",
            color="#000000", organisation_id=other.id, is_system=False,
        )
        db_session.add(foreign)
        db_session.commit()
        db_session.refresh(foreign)

        response = client.put(
            f"/api/device-types/{foreign.id}",
            json={"display_name": "Mine now"},
            headers=auth_headers,
        )
        assert response.status_code == 404


class TestDeactivateReactivateDeviceType:
    """Tests for deactivate/reactivate endpoints"""

    def test_deactivate_and_reactivate(
        self, client: TestClient, auth_headers: dict, create_device_type
    ):
        dt = create_device_type(slug="bat_detector", display_name="Bat Detector")

        deactivate = client.post(f"/api/device-types/{dt.id}/deactivate", headers=auth_headers)
        assert deactivate.status_code == 200
        assert deactivate.json()["is_active"] is False

        reactivate = client.post(f"/api/device-types/{dt.id}/reactivate", headers=auth_headers)
        assert reactivate.status_code == 200
        assert reactivate.json()["is_active"] is True

    def test_deactivate_system_type_forbidden(
        self, client: TestClient, auth_headers: dict, db_session: Session
    ):
        system = (
            db_session.query(DeviceTypeRegistry)
            .filter(DeviceTypeRegistry.slug == "refugia")
            .first()
        )
        response = client.post(f"/api/device-types/{system.id}/deactivate", headers=auth_headers)
        assert response.status_code == 403


class TestDeleteDeviceType:
    """Tests for DELETE /api/device-types/{id}"""

    def test_delete_unused_custom_type(
        self, client: TestClient, auth_headers: dict, create_device_type
    ):
        dt = create_device_type(slug="bat_detector", display_name="Bat Detector")
        response = client.delete(f"/api/device-types/{dt.id}", headers=auth_headers)
        assert response.status_code == 204

    def test_delete_blocked_when_device_uses_it(
        self, client: TestClient, auth_headers: dict, create_device_type, create_device
    ):
        dt = create_device_type(slug="bat_detector", display_name="Bat Detector")
        create_device(device_id="BAT001", device_type="bat_detector")

        response = client.delete(f"/api/device-types/{dt.id}", headers=auth_headers)
        assert response.status_code == 409

    def test_delete_blocked_when_survey_type_references_it(
        self, client: TestClient, auth_headers: dict, create_device_type, db_session: Session
    ):
        from models import SurveyType

        dt = create_device_type(slug="bat_detector", display_name="Bat Detector")
        # Reference the slug from a survey type directly.
        st = db_session.query(SurveyType).first()
        if st is None:
            st = SurveyType(name="ST", organisation_id=dt.organisation_id)
            db_session.add(st)
        st.sighting_device_type = "bat_detector"
        db_session.commit()

        response = client.delete(f"/api/device-types/{dt.id}", headers=auth_headers)
        assert response.status_code == 409

    def test_delete_system_type_forbidden(
        self, client: TestClient, auth_headers: dict, db_session: Session
    ):
        system = (
            db_session.query(DeviceTypeRegistry)
            .filter(DeviceTypeRegistry.slug == "audio_recorder")
            .first()
        )
        response = client.delete(f"/api/device-types/{system.id}", headers=auth_headers)
        assert response.status_code == 403
