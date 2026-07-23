"""
Tests for Survey Types Router

Tests CRUD operations for the /api/survey-types endpoints.
"""

from fastapi.testclient import TestClient

from models import DeviceType


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

    def test_create_survey_type_with_devices(
        self, client: TestClient, auth_headers: dict, create_device, create_species_type
    ):
        """Allocated devices round-trip through create -> details."""
        camera = create_device(device_id="CAM001", name="Pond Camera", device_type=DeviceType.camera_trap)
        species_type = create_species_type(name="mammal", display_name="Mammal")

        response = client.post(
            "/api/survey-types",
            json={
                "name": "Camera Trap",
                "species_type_ids": [species_type.id],
                "device_ids": [camera.id],
            },
            headers=auth_headers,
        )
        assert response.status_code == 201

        details = client.get(f"/api/survey-types/{response.json()['id']}", headers=auth_headers).json()
        assert [d["name"] for d in details["devices"]] == ["Pond Camera"]
        assert details["devices"][0]["latitude"] == 51.5
        assert details["devices"][0]["device_type"] == "camera_trap"

    def test_create_survey_type_rejects_unknown_device(
        self, client: TestClient, auth_headers: dict, create_species_type
    ):
        """Unknown (or other-org) device ids are a 400, not silent links."""
        species_type = create_species_type(name="mammal", display_name="Mammal")
        response = client.post(
            "/api/survey-types",
            json={"name": "Camera Trap", "species_type_ids": [species_type.id], "device_ids": [99999]},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "device" in response.json()["detail"].lower()

    def test_update_replaces_device_allocation(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_device
    ):
        """PUT with device_ids replaces the allocation; omitting it leaves it alone."""
        survey_type = create_survey_type(name="Audio")
        rec1 = create_device(device_id="REC001", name="West Recorder")
        rec2 = create_device(device_id="REC002", name="East Recorder")

        r = client.put(
            f"/api/survey-types/{survey_type.id}", json={"device_ids": [rec1.id]}, headers=auth_headers
        )
        assert r.status_code == 200
        details = client.get(f"/api/survey-types/{survey_type.id}", headers=auth_headers).json()
        assert [d["name"] for d in details["devices"]] == ["West Recorder"]

        # An update that doesn't mention device_ids keeps the allocation.
        r = client.put(
            f"/api/survey-types/{survey_type.id}", json={"description": "dawn chorus"}, headers=auth_headers
        )
        assert r.status_code == 200
        details = client.get(f"/api/survey-types/{survey_type.id}", headers=auth_headers).json()
        assert [d["name"] for d in details["devices"]] == ["West Recorder"]

        r = client.put(
            f"/api/survey-types/{survey_type.id}", json={"device_ids": [rec2.id]}, headers=auth_headers
        )
        assert r.status_code == 200
        details = client.get(f"/api/survey-types/{survey_type.id}", headers=auth_headers).json()
        assert [d["name"] for d in details["devices"]] == ["East Recorder"]

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


class TestSurveyTypeSpeciesNarrowing:
    """Tests for explicit species narrowing (survey_type_species links)"""

    def test_create_with_species_ids(
        self, client: TestClient, auth_headers: dict, create_species
    ):
        """Should store narrowed species and return them in details."""
        target = create_species(name="Marsh Fritillary", species_type="butterfly")
        create_species(name="Peacock", species_type="butterfly")

        response = client.post(
            "/api/survey-types",
            json={
                "name": "Marsh Fritillary Survey",
                "location_ids": [],
                "species_type_ids": [target.species_type_id],
                "species_ids": [target.id],
            },
            headers=auth_headers,
        )
        assert response.status_code == 201

        details = client.get(
            f"/api/survey-types/{response.json()['id']}", headers=auth_headers
        ).json()
        assert [s["id"] for s in details["species"]] == [target.id]

    def test_create_without_species_ids_leaves_species_empty(
        self, client: TestClient, auth_headers: dict, create_species
    ):
        """Details species list is empty when no narrowing is set."""
        sp = create_species(name="Peacock", species_type="butterfly")

        response = client.post(
            "/api/survey-types",
            json={
                "name": "Butterfly Survey",
                "location_ids": [],
                "species_type_ids": [sp.species_type_id],
            },
            headers=auth_headers,
        )
        assert response.status_code == 201

        details = client.get(
            f"/api/survey-types/{response.json()['id']}", headers=auth_headers
        ).json()
        assert details["species"] == []

    def test_create_rejects_unknown_species(
        self, client: TestClient, auth_headers: dict, create_species
    ):
        """Should 400 on species IDs that do not exist."""
        sp = create_species(name="Peacock", species_type="butterfly")

        response = client.post(
            "/api/survey-types",
            json={
                "name": "Bad Species Survey",
                "location_ids": [],
                "species_type_ids": [sp.species_type_id],
                "species_ids": [999999],
            },
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "Invalid species IDs" in response.json()["detail"]

    def test_create_rejects_species_outside_species_types(
        self, client: TestClient, auth_headers: dict, create_species
    ):
        """Should 400 when a narrowed species is not in the selected species types."""
        butterfly = create_species(name="Peacock", species_type="butterfly")
        bird = create_species(name="Turtle Dove", species_type="bird")

        response = client.post(
            "/api/survey-types",
            json={
                "name": "Mismatched Survey",
                "location_ids": [],
                "species_type_ids": [butterfly.species_type_id],
                "species_ids": [bird.id],
            },
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "outside the selected species types" in response.json()["detail"]

    def test_update_replaces_and_clears_species(
        self, client: TestClient, auth_headers: dict, create_species
    ):
        """PUT with species_ids replaces the narrowing; empty list clears it."""
        first = create_species(name="Marsh Fritillary", species_type="butterfly")
        second = create_species(name="Peacock", species_type="butterfly")

        created = client.post(
            "/api/survey-types",
            json={
                "name": "Narrowed Survey",
                "location_ids": [],
                "species_type_ids": [first.species_type_id],
                "species_ids": [first.id],
            },
            headers=auth_headers,
        ).json()

        response = client.put(
            f"/api/survey-types/{created['id']}",
            json={"species_ids": [second.id]},
            headers=auth_headers,
        )
        assert response.status_code == 200
        details = client.get(
            f"/api/survey-types/{created['id']}", headers=auth_headers
        ).json()
        assert [s["id"] for s in details["species"]] == [second.id]

        response = client.put(
            f"/api/survey-types/{created['id']}",
            json={"species_ids": []},
            headers=auth_headers,
        )
        assert response.status_code == 200
        details = client.get(
            f"/api/survey-types/{created['id']}", headers=auth_headers
        ).json()
        assert details["species"] == []

    def test_update_species_types_prunes_outside_species(
        self, client: TestClient, auth_headers: dict, create_species
    ):
        """Changing species types drops narrowed species outside the new set."""
        butterfly = create_species(name="Marsh Fritillary", species_type="butterfly")
        bird = create_species(name="Turtle Dove", species_type="bird")

        created = client.post(
            "/api/survey-types",
            json={
                "name": "Pruned Survey",
                "location_ids": [],
                "species_type_ids": [butterfly.species_type_id, bird.species_type_id],
                "species_ids": [butterfly.id, bird.id],
            },
            headers=auth_headers,
        ).json()

        response = client.put(
            f"/api/survey-types/{created['id']}",
            json={"species_type_ids": [bird.species_type_id]},
            headers=auth_headers,
        )
        assert response.status_code == 200
        details = client.get(
            f"/api/survey-types/{created['id']}", headers=auth_headers
        ).json()
        assert [s["id"] for s in details["species"]] == [bird.id]
