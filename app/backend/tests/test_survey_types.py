"""
Tests for Survey Types Router

Tests CRUD operations for the /api/survey-types endpoints.
"""

from fastapi.testclient import TestClient


class TestGetSurveyTypes:
    """Tests for GET /api/survey-types"""

    def test_get_survey_types_empty(self, client: TestClient, auth_headers: dict):
        """Should return empty list when no survey types exist."""
        response = client.get("/api/survey-types", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []

    def test_get_survey_types_returns_list(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """Should return list of active survey types."""
        create_survey_type(name="Bird Survey")
        create_survey_type(name="Butterfly Survey")

        response = client.get("/api/survey-types", headers=auth_headers)
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 2

    def test_get_survey_types_excludes_inactive(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """Should exclude inactive survey types by default."""
        create_survey_type(name="Active", is_active=True)
        create_survey_type(name="Inactive", is_active=False)

        response = client.get("/api/survey-types", headers=auth_headers)
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "Active"

    def test_get_survey_types_includes_inactive(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """Should include inactive when requested."""
        create_survey_type(name="Active", is_active=True)
        create_survey_type(name="Inactive", is_active=False)

        response = client.get(
            "/api/survey-types?include_inactive=true", headers=auth_headers
        )
        assert response.status_code == 200
        assert len(response.json()) == 2


class TestGetSurveyTypeById:
    """Tests for GET /api/survey-types/{id}"""

    def test_get_survey_type_by_id(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """Should return survey type with details."""
        survey_type = create_survey_type(name="Test Type")

        response = client.get(
            f"/api/survey-types/{survey_type.id}", headers=auth_headers
        )
        assert response.status_code == 200

        data = response.json()
        assert data["id"] == survey_type.id
        assert data["name"] == "Test Type"
        assert "locations" in data
        assert "species_types" in data

    def test_get_survey_type_not_found(self, client: TestClient, auth_headers: dict):
        """Should return 404 for non-existent survey type."""
        response = client.get("/api/survey-types/99999", headers=auth_headers)
        assert response.status_code == 404

    def test_get_survey_type_returns_schedule_cadence(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """The detail response must reflect the stored cadence, not the default."""
        weekly = create_survey_type(name="Butterfly", schedule_cadence="weekly")

        data = client.get(f"/api/survey-types/{weekly.id}", headers=auth_headers).json()
        assert data["schedule_cadence"] == "weekly"

    def test_get_survey_type_sector_locations_carry_parent_name(
        self, client: TestClient, auth_headers: dict
    ):
        """Sector locations assigned to a type must include their route's name,
        so clients can render them as "<route> - <sector>"."""
        route = client.post(
            "/api/locations",
            json={
                "name": "Transect",
                "location_type": "route",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-2.38, 51.15], [-2.375, 51.155], [-2.37, 51.16]],
                },
                "sectors": [
                    {
                        "name": "Woodland ride",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[-2.38, 51.15], [-2.375, 51.155]],
                        },
                    },
                ],
            },
            headers=auth_headers,
        )
        assert route.status_code == 201

        flat = client.get("/api/locations", headers=auth_headers).json()
        sector = next(loc for loc in flat if loc["name"] == "Woodland ride")

        created = client.post(
            "/api/survey-types",
            json={
                "name": "Butterfly",
                "location_ids": [sector["id"]],
                "species_type_ids": [],
            },
            headers=auth_headers,
        )
        assert created.status_code == 201

        data = client.get(
            f"/api/survey-types/{created.json()['id']}", headers=auth_headers
        ).json()
        assert [
            (loc["name"], loc["parent_name"], loc["ordinal"]) for loc in data["locations"]
        ] == [("Woodland ride", "Transect", 1)]


class TestCreateSurveyType:
    """Tests for POST /api/survey-types"""

    def test_create_survey_type(
        self, client: TestClient, auth_headers: dict,
        create_location, create_species_type
    ):
        """Should create a new survey type with locations and species types."""
        location = create_location(name="Test Field")
        species_type = create_species_type(name="bird", display_name="Bird")

        response = client.post(
            "/api/survey-types",
            json={
                "name": "New Survey Type",
                "description": "A test survey type",
                "location_ids": [location.id],
                "species_type_ids": [species_type.id],
            },
            headers=auth_headers,
        )
        assert response.status_code == 201

        data = response.json()
        assert data["name"] == "New Survey Type"
        assert data["is_active"] is True

    def test_create_survey_type_duplicate_name(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """Should return 400 for duplicate name."""
        create_survey_type(name="Existing Type")

        response = client.post(
            "/api/survey-types",
            json={
                "name": "Existing Type",
                "location_ids": [],
                "species_type_ids": [],
            },
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"].lower()

    def test_create_survey_type_unauthorized(self, client: TestClient):
        """Should return 401 without authentication."""
        response = client.post(
            "/api/survey-types",
            json={"name": "Test", "location_ids": [], "species_type_ids": []},
        )
        assert response.status_code == 401


class TestDeleteSurveyType:
    """Tests for DELETE /api/survey-types/{id} (soft delete)"""

    def test_delete_survey_type(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """Should soft delete (deactivate) survey type."""
        survey_type = create_survey_type(name="To Deactivate", is_active=True)

        response = client.delete(
            f"/api/survey-types/{survey_type.id}", headers=auth_headers
        )
        assert response.status_code == 204

        # Verify it's now inactive (not in default list)
        list_response = client.get("/api/survey-types", headers=auth_headers)
        names = [st["name"] for st in list_response.json()]
        assert "To Deactivate" not in names


class TestReactivateSurveyType:
    """Tests for POST /api/survey-types/{id}/reactivate"""

    def test_reactivate_survey_type(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """Should reactivate an inactive survey type."""
        survey_type = create_survey_type(name="Inactive", is_active=False)

        response = client.post(
            f"/api/survey-types/{survey_type.id}/reactivate", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["is_active"] is True
