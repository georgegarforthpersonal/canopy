"""
Tests for Dashboard Router

Tests read-only analytics endpoints for the dashboard.
"""

from datetime import date

from fastapi.testclient import TestClient


class TestCumulativeSpecies:
    """Tests for GET /api/dashboard/cumulative-species"""

    def test_cumulative_species_empty(self, client: TestClient, auth_headers: dict):
        """Should return empty data when no surveys exist."""
        response = client.get(
            "/api/dashboard/cumulative-species", headers=auth_headers
        )
        assert response.status_code == 200

        data = response.json()
        assert data["data"] == []
        assert "date_range" in data

    def test_cumulative_species_with_filter(
        self, client: TestClient, auth_headers: dict
    ):
        """Should accept species_types filter."""
        response = client.get(
            "/api/dashboard/cumulative-species?species_types=bird&species_types=butterfly",
            headers=auth_headers,
        )
        assert response.status_code == 200


class TestSpeciesTypesWithEntries:
    """Tests for GET /api/dashboard/species-types-with-entries"""

    def test_species_types_with_entries(self, client: TestClient, auth_headers: dict):
        """Should return list of species types that have sightings."""
        response = client.get(
            "/api/dashboard/species-types-with-entries", headers=auth_headers
        )
        assert response.status_code == 200
        assert isinstance(response.json(), list)


class TestSpeciesByCount:
    """Tests for GET /api/dashboard/species-by-count"""

    def test_species_by_count(self, client: TestClient, auth_headers: dict):
        """Should return species ordered by count."""
        response = client.get(
            "/api/dashboard/species-by-count?species_type=butterfly",
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_species_by_count_requires_type(
        self, client: TestClient, auth_headers: dict
    ):
        """Should require species_type parameter."""
        response = client.get(
            "/api/dashboard/species-by-count", headers=auth_headers
        )
        assert response.status_code == 422  # Validation error

    def test_counts_and_first_observed(
        self, client: TestClient, auth_headers: dict, create_species, create_survey
    ):
        """Occurrences sum across surveys; first_observed is the earliest
        survey date that recorded the species."""
        species = create_species(name="Peacock", species_type="butterfly")
        older = create_survey(survey_date=date(2024, 5, 1))
        newer = create_survey(survey_date=date(2024, 6, 15))
        for survey, count in ((newer, 3), (older, 2)):
            resp = client.post(
                f"/api/surveys/{survey.id}/sightings",
                json={"species_id": species.id, "count": count},
                headers=auth_headers,
            )
            assert resp.status_code == 201

        rows = client.get(
            "/api/dashboard/species-by-count?species_type=butterfly",
            headers=auth_headers,
        ).json()
        row = next(r for r in rows if r["id"] == species.id)
        assert row["total_count"] == 5
        assert row["first_observed"] == "2024-05-01"


class TestSpeciesOccurrences:
    """Tests for GET /api/dashboard/species-occurrences"""

    def test_species_occurrences(
        self, client: TestClient, auth_headers: dict, create_species
    ):
        """Should return occurrence data for a species."""
        species = create_species(name="Test Bird", species_type="bird")

        response = client.get(
            f"/api/dashboard/species-occurrences?species_id={species.id}",
            headers=auth_headers,
        )
        assert response.status_code == 200

        data = response.json()
        assert "data" in data
        assert "date_range" in data
        assert "species_name" in data

    def test_species_occurrences_requires_species_id(
        self, client: TestClient, auth_headers: dict
    ):
        """Should require species_id parameter."""
        response = client.get(
            "/api/dashboard/species-occurrences", headers=auth_headers
        )
        assert response.status_code == 422  # Validation error


class TestSpeciesSightings:
    """Tests for GET /api/dashboard/species-sightings"""

    def test_species_sightings(
        self, client: TestClient, auth_headers: dict, create_species
    ):
        """Should return sighting locations for a species."""
        species = create_species(name="Test Species")

        response = client.get(
            f"/api/dashboard/species-sightings?species_id={species.id}",
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_species_sightings_with_date_filter(
        self, client: TestClient, auth_headers: dict, create_species
    ):
        """Should accept date range filters."""
        species = create_species(name="Test Species 2")

        response = client.get(
            f"/api/dashboard/species-sightings?species_id={species.id}"
            "&start_date=2024-01-01&end_date=2024-12-31",
            headers=auth_headers,
        )
        assert response.status_code == 200
