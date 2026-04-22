"""
Tests for Surveys Router

Tests CRUD operations for the /api/surveys endpoints.
"""

from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import text


class TestGetSurveys:
    """Tests for GET /api/surveys"""

    def test_get_surveys_empty(self, client: TestClient, auth_headers: dict):
        """Should return empty data when no surveys exist."""
        response = client.get("/api/surveys", headers=auth_headers)
        assert response.status_code == 200

        data = response.json()
        assert data["data"] == []
        assert data["total"] == 0

    def test_get_surveys_returns_paginated_list(
        self, client: TestClient, auth_headers: dict, create_survey, create_surveyor
    ):
        """Should return paginated list of surveys."""
        surveyor = create_surveyor()
        create_survey(surveyor_ids=[surveyor.id])
        create_survey(surveyor_ids=[surveyor.id])

        response = client.get("/api/surveys", headers=auth_headers)
        assert response.status_code == 200

        data = response.json()
        assert len(data["data"]) == 2
        assert data["total"] == 2
        assert data["page"] == 1

    def test_get_surveys_pagination(
        self, client: TestClient, auth_headers: dict, create_survey, create_surveyor
    ):
        """Should respect pagination parameters."""
        surveyor = create_surveyor()
        for _ in range(5):
            create_survey(surveyor_ids=[surveyor.id])

        response = client.get(
            "/api/surveys?page=1&limit=2", headers=auth_headers
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data["data"]) == 2
        assert data["total"] == 5
        assert data["total_pages"] == 3


class TestGetSurveyById:
    """Tests for GET /api/surveys/{id}"""

    def test_get_survey_by_id(
        self, client: TestClient, auth_headers: dict, create_survey, create_surveyor
    ):
        """Should return survey by ID."""
        surveyor = create_surveyor()
        survey = create_survey(
            survey_date=date(2024, 6, 15),
            surveyor_ids=[surveyor.id],
        )

        response = client.get(f"/api/surveys/{survey.id}", headers=auth_headers)
        assert response.status_code == 200

        data = response.json()
        assert data["id"] == survey.id
        assert data["date"] == "2024-06-15"
        assert surveyor.id in data["surveyor_ids"]

    def test_get_survey_not_found(self, client: TestClient, auth_headers: dict):
        """Should return 404 for non-existent survey."""
        response = client.get("/api/surveys/99999", headers=auth_headers)
        assert response.status_code == 404


class TestCreateSurvey:
    """Tests for POST /api/surveys"""

    def test_create_survey(
        self, client: TestClient, auth_headers: dict, create_surveyor
    ):
        """Should create a new survey."""
        surveyor = create_surveyor()

        response = client.post(
            "/api/surveys",
            json={
                "date": "2024-07-01",
                "surveyor_ids": [surveyor.id],
            },
            headers=auth_headers,
        )
        assert response.status_code == 201

        data = response.json()
        assert data["date"] == "2024-07-01"
        assert surveyor.id in data["surveyor_ids"]

    def test_create_survey_with_location(
        self, client: TestClient, auth_headers: dict,
        create_surveyor, create_location
    ):
        """Should create survey with location."""
        surveyor = create_surveyor()
        location = create_location(name="Field A")

        response = client.post(
            "/api/surveys",
            json={
                "date": "2024-07-01",
                "surveyor_ids": [surveyor.id],
                "location_id": location.id,
            },
            headers=auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["location_id"] == location.id

    def test_create_survey_unauthorized(self, client: TestClient):
        """Should return 401 without authentication."""
        response = client.post(
            "/api/surveys",
            json={"date": "2024-07-01", "surveyor_ids": []},
        )
        assert response.status_code == 401


class TestUpdateSurvey:
    """Tests for PUT /api/surveys/{id}"""

    def test_update_survey(
        self, client: TestClient, auth_headers: dict, create_survey, create_surveyor
    ):
        """Should update survey fields."""
        surveyor = create_surveyor()
        survey = create_survey(surveyor_ids=[surveyor.id])

        response = client.put(
            f"/api/surveys/{survey.id}",
            json={"notes": "Updated notes"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["notes"] == "Updated notes"

    def test_update_survey_not_found(self, client: TestClient, auth_headers: dict):
        """Should return 404 for non-existent survey."""
        response = client.put(
            "/api/surveys/99999",
            json={"notes": "Test"},
            headers=auth_headers,
        )
        assert response.status_code == 404


class TestDeleteSurvey:
    """Tests for DELETE /api/surveys/{id}"""

    def test_delete_survey(
        self, client: TestClient, auth_headers: dict, create_survey, create_surveyor
    ):
        """Should delete survey."""
        surveyor = create_surveyor()
        survey = create_survey(surveyor_ids=[surveyor.id])

        response = client.delete(f"/api/surveys/{survey.id}", headers=auth_headers)
        assert response.status_code == 204

        # Verify deleted
        get_response = client.get(f"/api/surveys/{survey.id}", headers=auth_headers)
        assert get_response.status_code == 404

    def test_delete_survey_not_found(self, client: TestClient, auth_headers: dict):
        """Should return 404 for non-existent survey."""
        response = client.delete("/api/surveys/99999", headers=auth_headers)
        assert response.status_code == 404


class TestSurveySightings:
    """Tests for survey sighting endpoints"""

    def test_get_sightings_empty(
        self, client: TestClient, auth_headers: dict, create_survey, create_surveyor
    ):
        """Should return empty list when no sightings exist."""
        surveyor = create_surveyor()
        survey = create_survey(surveyor_ids=[surveyor.id])

        response = client.get(
            f"/api/surveys/{survey.id}/sightings", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json() == []

    def test_create_sighting(
        self, client: TestClient, auth_headers: dict,
        create_survey, create_surveyor, create_species
    ):
        """Should create a sighting for a survey."""
        surveyor = create_surveyor()
        survey = create_survey(surveyor_ids=[surveyor.id])
        species = create_species(name="Red Admiral")

        response = client.post(
            f"/api/surveys/{survey.id}/sightings",
            json={
                "species_id": species.id,
                "count": 5,
            },
            headers=auth_headers,
        )
        assert response.status_code == 201

        data = response.json()
        assert data["species_id"] == species.id
        assert data["count"] == 5

    def test_get_sightings_for_nonexistent_survey(
        self, client: TestClient, auth_headers: dict
    ):
        """Should return 404 for non-existent survey."""
        response = client.get("/api/surveys/99999/sightings", headers=auth_headers)
        assert response.status_code == 404


class TestSightingDeviceAttach:
    """Tests for create_sighting in device-attach (refugia-style) mode."""

    @staticmethod
    def _device_survey_type(db_session, test_org):
        """Create a survey type that requires device selection on sightings."""
        from models import SurveyType, DeviceType
        st = SurveyType(
            name="Refugia check",
            organisation_id=test_org.id,
            allow_sighting_device_selection=True,
            sighting_device_type=DeviceType.refugia,
            location_at_sighting_level=False,
            allow_geolocation=False,
        )
        db_session.add(st)
        db_session.commit()
        db_session.refresh(st)
        return st

    def test_create_sighting_with_matching_device(
        self, client, auth_headers, db_session, test_org,
        create_survey, create_surveyor, create_species, create_device,
    ):
        """Should accept device_id when type matches and auto-materialise a sighting_individual."""
        from models import DeviceType
        st = self._device_survey_type(db_session, test_org)
        surveyor = create_surveyor()
        survey = create_survey(surveyor_ids=[surveyor.id], survey_type_id=st.id)
        species = create_species(name="Slow Worm")
        device = create_device(
            device_id="REF001",
            device_type=DeviceType.refugia,
            latitude=52.0,
            longitude=-1.0,
        )

        response = client.post(
            f"/api/surveys/{survey.id}/sightings",
            json={"species_id": species.id, "count": 3, "device_id": device.id},
            headers=auth_headers,
        )
        assert response.status_code == 201, response.text
        data = response.json()
        assert data["device_id"] == device.id
        assert data["count"] == 3

        # The auto-created sighting_individual should sit at the device's coords.
        ind_row = db_session.execute(
            text(
                "SELECT count, ST_Y(coordinates) AS lat, ST_X(coordinates) AS lng "
                "FROM sighting_individual WHERE sighting_id = :sid"
            ),
            {"sid": data["id"]},
        ).fetchone()
        assert ind_row is not None
        assert ind_row.count == 3
        assert ind_row.lat == 52.0
        assert ind_row.lng == -1.0

    def test_create_sighting_rejects_mismatched_device_type(
        self, client, auth_headers, db_session, test_org,
        create_survey, create_surveyor, create_species, create_device,
    ):
        """Should 400 when the attached device's type doesn't match the survey type."""
        from models import DeviceType
        st = self._device_survey_type(db_session, test_org)
        surveyor = create_surveyor()
        survey = create_survey(surveyor_ids=[surveyor.id], survey_type_id=st.id)
        species = create_species(name="Slow Worm")
        device = create_device(
            device_id="CAM001",
            device_type=DeviceType.camera_trap,
        )

        response = client.post(
            f"/api/surveys/{survey.id}/sightings",
            json={"species_id": species.id, "count": 1, "device_id": device.id},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "does not match" in response.json()["detail"]

    def test_create_sighting_rejects_device_when_feature_disabled(
        self, client, auth_headers, create_survey, create_surveyor,
        create_species, create_device,
    ):
        """Should 400 when sending device_id to a survey type that doesn't allow it."""
        surveyor = create_surveyor()
        survey = create_survey(surveyor_ids=[surveyor.id])  # default survey type — no device selection
        species = create_species(name="Slow Worm")
        device = create_device(device_id="ANY001")

        response = client.post(
            f"/api/surveys/{survey.id}/sightings",
            json={"species_id": species.id, "count": 1, "device_id": device.id},
            headers=auth_headers,
        )
        assert response.status_code == 400
