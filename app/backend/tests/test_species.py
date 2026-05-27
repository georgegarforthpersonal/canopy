"""
Tests for Species Router

Tests CRUD operations for the /api/species endpoints.
"""

from fastapi.testclient import TestClient


class TestGetSpecies:
    """Tests for GET /api/species"""

    def test_get_species_returns_list(self, client: TestClient, auth_headers: dict):
        """Should return list of species."""
        response = client.get("/api/species", headers=auth_headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_get_species_filter_by_type(
        self, client: TestClient, auth_headers: dict, create_species
    ):
        """Should filter species by type."""
        # Ensure a butterfly species exists
        create_species(name="Filter Test Butterfly", species_type="butterfly")

        response = client.get(
            "/api/species?survey_type=butterfly", headers=auth_headers
        )
        assert response.status_code == 200

        # All returned species should be butterflies
        for species in response.json():
            assert species["type"] == "butterfly"
            assert "species_type_id" in species


class TestGetSpeciesById:
    """Tests for GET /api/species/{id}"""

    def test_get_species_not_found(self, client: TestClient, auth_headers: dict):
        """Should return 404 for non-existent species."""
        response = client.get("/api/species/999999", headers=auth_headers)
        assert response.status_code == 404


class TestCreateSpecies:
    """Tests for POST /api/species"""

    def test_create_species(self, client: TestClient, auth_headers: dict, create_species_type):
        """Should create a new species."""
        # Ensure species type exists
        st = create_species_type(name="butterfly", display_name="Butterfly")

        response = client.post(
            "/api/species",
            json={
                "name": "Test Butterfly",
                "scientific_name": "Testus butterflicus",
                "species_type_id": st.id,
            },
            headers=auth_headers,
        )
        assert response.status_code == 201

        data = response.json()
        assert data["name"] == "Test Butterfly"
        assert data["scientific_name"] == "Testus butterflicus"
        assert data["species_type_id"] == st.id
        assert data["type"] == "butterfly"

        # Clean up - delete the created species
        client.delete(f"/api/species/{data['id']}", headers=auth_headers)

    def test_create_species_persists_nbn_atlas_guid(
        self, client: TestClient, auth_headers: dict, create_species_type
    ):
        """nbn_atlas_guid sent on create must be saved and read back.

        Regression: create_species built the Species row without nbn_atlas_guid,
        so the identifier was silently dropped.
        """
        st = create_species_type(name="butterfly", display_name="Butterfly")

        response = client.post(
            "/api/species",
            json={
                "name": "Guid Butterfly",
                "species_type_id": st.id,
                "nbn_atlas_guid": "NBNSYS0000008319",
            },
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["nbn_atlas_guid"] == "NBNSYS0000008319"

        try:
            # Re-fetch to confirm persistence, not just echo.
            fetched = client.get(f"/api/species/{data['id']}", headers=auth_headers)
            assert fetched.status_code == 200
            assert fetched.json()["nbn_atlas_guid"] == "NBNSYS0000008319"
        finally:
            client.delete(f"/api/species/{data['id']}", headers=auth_headers)

    def test_create_species_invalid_type_id(self, client: TestClient, auth_headers: dict):
        """Should return 400 for invalid species_type_id."""
        response = client.post(
            "/api/species",
            json={"name": "Test", "species_type_id": 999999},
            headers=auth_headers,
        )
        assert response.status_code == 400

    def test_create_species_unauthorized(self, client: TestClient):
        """Should return 401 without authentication."""
        response = client.post(
            "/api/species",
            json={"name": "Test", "species_type_id": 1},
        )
        assert response.status_code == 401


class TestUpdateSpecies:
    """Tests for PUT /api/species/{id}"""

    def test_update_species(self, client: TestClient, auth_headers: dict, create_species_type):
        """Should update species fields."""
        st = create_species_type(name="butterfly", display_name="Butterfly")

        # Create a species first
        create_response = client.post(
            "/api/species",
            json={
                "name": "Original Name",
                "species_type_id": st.id,
            },
            headers=auth_headers,
        )
        species_id = create_response.json()["id"]

        try:
            # Update it
            response = client.put(
                f"/api/species/{species_id}",
                json={"name": "Updated Name"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["name"] == "Updated Name"
        finally:
            # Clean up
            client.delete(f"/api/species/{species_id}", headers=auth_headers)

    def test_update_species_not_found(self, client: TestClient, auth_headers: dict):
        """Should return 404 for non-existent species."""
        response = client.put(
            "/api/species/999999",
            json={"name": "Test"},
            headers=auth_headers,
        )
        assert response.status_code == 404


class TestDeleteSpecies:
    """Tests for DELETE /api/species/{id}"""

    def test_delete_species(self, client: TestClient, auth_headers: dict, create_species_type):
        """Should delete species."""
        st = create_species_type(name="butterfly", display_name="Butterfly")

        # Create a species first
        create_response = client.post(
            "/api/species",
            json={
                "name": "To Delete",
                "species_type_id": st.id,
            },
            headers=auth_headers,
        )
        species_id = create_response.json()["id"]

        # Delete it
        response = client.delete(
            f"/api/species/{species_id}", headers=auth_headers
        )
        assert response.status_code == 204

        # Verify deleted
        get_response = client.get(
            f"/api/species/{species_id}", headers=auth_headers
        )
        assert get_response.status_code == 404

    def test_delete_species_not_found(self, client: TestClient, auth_headers: dict):
        """Should return 404 for non-existent species."""
        response = client.delete("/api/species/999999", headers=auth_headers)
        assert response.status_code == 404
