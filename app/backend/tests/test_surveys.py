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

    def test_create_sighting_persists_notes(
        self, client: TestClient, auth_headers: dict,
        create_survey, create_surveyor, create_species
    ):
        """Notes sent on create must be saved and read back.

        Regression: create_sighting built the Sighting row without `notes`,
        so notes entered at creation time were silently dropped.
        """
        surveyor = create_surveyor()
        survey = create_survey(surveyor_ids=[surveyor.id])
        species = create_species(name="Red Admiral")

        response = client.post(
            f"/api/surveys/{survey.id}/sightings",
            json={
                "species_id": species.id,
                "count": 5,
                "notes": "seen near the hedge",
            },
            headers=auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["notes"] == "seen near the hedge"

        # Re-fetch from the DB to confirm the note was persisted, not just echoed.
        listing = client.get(
            f"/api/surveys/{survey.id}/sightings", headers=auth_headers
        )
        assert listing.status_code == 200
        assert listing.json()[0]["notes"] == "seen near the hedge"

    def test_update_sighting_returns_notes(
        self, client: TestClient, auth_headers: dict,
        create_survey, create_surveyor, create_species
    ):
        """The update response must echo persisted fields.

        Regression: update_sighting's response dict omitted notes/location_id/
        device_id even though they were saved, so clients read them back as null.
        """
        surveyor = create_surveyor()
        survey = create_survey(surveyor_ids=[surveyor.id])
        species = create_species(name="Peacock")

        created = client.post(
            f"/api/surveys/{survey.id}/sightings",
            json={"species_id": species.id, "count": 1},
            headers=auth_headers,
        )
        sighting_id = created.json()["id"]

        response = client.put(
            f"/api/surveys/{survey.id}/sightings/{sighting_id}",
            json={"notes": "updated note"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["notes"] == "updated note"

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


class TestClientUuidIdempotency:
    """Retried creates carrying a client_uuid must not insert duplicates.

    Field clients retry saves whose responses were lost on flaky signal; the
    create endpoints return the already-created row when they have seen the
    UUID before.
    """

    def test_create_survey_retry_returns_same_survey(
        self, client: TestClient, auth_headers: dict, create_surveyor
    ):
        surveyor = create_surveyor()
        payload = {
            "date": "2026-07-01",
            "surveyor_ids": [surveyor.id],
            "client_uuid": "11111111-1111-4111-8111-111111111111",
        }

        first = client.post("/api/surveys", json=payload, headers=auth_headers)
        assert first.status_code == 201
        retry = client.post("/api/surveys", json=payload, headers=auth_headers)
        assert retry.status_code == 201

        assert retry.json()["id"] == first.json()["id"]
        assert retry.json()["client_uuid"] == payload["client_uuid"]
        assert surveyor.id in retry.json()["surveyor_ids"]

        listing = client.get("/api/surveys", headers=auth_headers)
        assert listing.json()["total"] == 1

    def test_create_survey_distinct_uuids_create_distinct_surveys(
        self, client: TestClient, auth_headers: dict, create_surveyor
    ):
        surveyor = create_surveyor()
        base = {"date": "2026-07-01", "surveyor_ids": [surveyor.id]}

        a = client.post(
            "/api/surveys",
            json={**base, "client_uuid": "22222222-2222-4222-8222-222222222222"},
            headers=auth_headers,
        )
        b = client.post(
            "/api/surveys",
            json={**base, "client_uuid": "33333333-3333-4333-8333-333333333333"},
            headers=auth_headers,
        )
        assert a.json()["id"] != b.json()["id"]

    def test_create_survey_without_uuid_still_duplicates(
        self, client: TestClient, auth_headers: dict, create_surveyor
    ):
        """Legacy behaviour is unchanged when no client_uuid is sent."""
        surveyor = create_surveyor()
        payload = {"date": "2026-07-01", "surveyor_ids": [surveyor.id]}

        a = client.post("/api/surveys", json=payload, headers=auth_headers)
        b = client.post("/api/surveys", json=payload, headers=auth_headers)
        assert a.json()["id"] != b.json()["id"]

    def test_create_sighting_retry_returns_same_sighting(
        self, client: TestClient, auth_headers: dict,
        create_survey, create_surveyor, create_species
    ):
        surveyor = create_surveyor()
        survey = create_survey(surveyor_ids=[surveyor.id])
        species = create_species(name="Comma")
        payload = {
            "species_id": species.id,
            "count": 3,
            "notes": "by the gate",
            "client_uuid": "44444444-4444-4444-8444-444444444444",
        }

        first = client.post(
            f"/api/surveys/{survey.id}/sightings", json=payload, headers=auth_headers
        )
        assert first.status_code == 201
        retry = client.post(
            f"/api/surveys/{survey.id}/sightings", json=payload, headers=auth_headers
        )
        assert retry.status_code == 201

        assert retry.json()["id"] == first.json()["id"]
        assert retry.json()["client_uuid"] == payload["client_uuid"]
        assert retry.json()["count"] == 3
        assert retry.json()["notes"] == "by the gate"

        listing = client.get(
            f"/api/surveys/{survey.id}/sightings", headers=auth_headers
        )
        assert len(listing.json()) == 1
        assert listing.json()[0]["client_uuid"] == payload["client_uuid"]

    def test_same_sighting_uuid_on_different_surveys_is_independent(
        self, client: TestClient, auth_headers: dict,
        create_survey, create_surveyor, create_species
    ):
        """Sighting uuids are scoped to their survey, not global."""
        surveyor = create_surveyor()
        survey_a = create_survey(surveyor_ids=[surveyor.id])
        survey_b = create_survey(surveyor_ids=[surveyor.id])
        species = create_species(name="Brimstone")
        payload = {
            "species_id": species.id,
            "count": 1,
            "client_uuid": "55555555-5555-4555-8555-555555555555",
        }

        a = client.post(
            f"/api/surveys/{survey_a.id}/sightings", json=payload, headers=auth_headers
        )
        b = client.post(
            f"/api/surveys/{survey_b.id}/sightings", json=payload, headers=auth_headers
        )
        assert a.status_code == 201 and b.status_code == 201
        assert a.json()["id"] != b.json()["id"]
