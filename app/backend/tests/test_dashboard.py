"""
Tests for Dashboard Router

Tests read-only analytics endpoints for the dashboard.
"""

from datetime import date

from fastapi.testclient import TestClient



def _add_sighting(client, auth_headers, survey_id, species_id, count):
    resp = client.post(
        f"/api/surveys/{survey_id}/sightings",
        json={"species_id": species_id, "count": count},
        headers=auth_headers,
    )
    assert resp.status_code == 201


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


class TestSurveyTypeScoping:
    """The survey_type_id filter scopes dashboard data to one group's surveys."""

    def test_species_by_count_scoped_to_survey_type(
        self, client: TestClient, auth_headers: dict,
        create_species, create_survey, create_survey_type,
    ):
        """Sightings from other survey types (e.g. ad hoc) must not leak in."""
        walking = create_survey_type(name="Walking Survey")
        adhoc = create_survey_type(name="Ad Hoc")
        fritillary = create_species(name="Marsh Fritillary", species_type="butterfly")
        peacock = create_species(name="Peacock", species_type="butterfly")

        walking_survey = create_survey(survey_date=date(2024, 5, 1), survey_type_id=walking.id)
        adhoc_survey = create_survey(survey_date=date(2024, 5, 2), survey_type_id=adhoc.id)
        _add_sighting(client, auth_headers, walking_survey.id, fritillary.id, 3)
        _add_sighting(client, auth_headers, adhoc_survey.id, fritillary.id, 2)
        _add_sighting(client, auth_headers, adhoc_survey.id, peacock.id, 5)

        rows = client.get(
            f"/api/dashboard/species-by-count?species_type=butterfly&survey_type_id={walking.id}",
            headers=auth_headers,
        ).json()
        assert [(r["id"], r["total_count"]) for r in rows] == [(fritillary.id, 3)]

    def test_cumulative_species_scoped_to_survey_type(
        self, client: TestClient, auth_headers: dict,
        create_species, create_survey, create_survey_type,
    ):
        """Cumulative unique-species counts only cover the given survey type."""
        walking = create_survey_type(name="Walking Survey")
        adhoc = create_survey_type(name="Ad Hoc")
        fritillary = create_species(name="Marsh Fritillary", species_type="butterfly")
        peacock = create_species(name="Peacock", species_type="butterfly")

        walking_survey = create_survey(survey_date=date(2024, 5, 1), survey_type_id=walking.id)
        adhoc_survey = create_survey(survey_date=date(2024, 5, 2), survey_type_id=adhoc.id)
        _add_sighting(client, auth_headers, walking_survey.id, fritillary.id, 3)
        _add_sighting(client, auth_headers, adhoc_survey.id, peacock.id, 5)

        data = client.get(
            f"/api/dashboard/cumulative-species?survey_type_id={walking.id}",
            headers=auth_headers,
        ).json()["data"]
        # Only the walking survey's date appears, and only its species count.
        assert {d["date"] for d in data} == {"2024-05-01"}
        assert max(d["cumulative_count"] for d in data) == 1
        new_species = [s for d in data for s in d["new_species"]]
        assert "Peacock" not in new_species

    def test_species_occurrences_scoped_to_type(
        self, client: TestClient, auth_headers: dict,
        create_species, create_survey, create_survey_type,
    ):
        """Occurrences cover only surveys of the given type; a survey with no
        sighting is a real zero-count point."""
        walking = create_survey_type(name="Walking Survey")
        adhoc = create_survey_type(name="Ad Hoc")
        fritillary = create_species(name="Marsh Fritillary", species_type="butterfly")

        seen = create_survey(survey_date=date(2024, 5, 1), survey_type_id=walking.id)
        none_seen = create_survey(survey_date=date(2024, 5, 8), survey_type_id=walking.id)
        other_type = create_survey(survey_date=date(2024, 5, 2), survey_type_id=adhoc.id)

        _add_sighting(client, auth_headers, seen.id, fritillary.id, 4)
        _add_sighting(client, auth_headers, other_type.id, fritillary.id, 7)

        data = client.get(
            f"/api/dashboard/species-occurrences?species_id={fritillary.id}&survey_type_id={walking.id}",
            headers=auth_headers,
        ).json()["data"]
        assert [(d["survey_id"], d["occurrence_count"]) for d in data] == [
            (seen.id, 4),
            (none_seen.id, 0),
        ]


    def test_species_occurrences_unscoped_covers_only_relevant_types(
        self, client: TestClient, auth_headers: dict, db_session,
        create_species, create_survey, create_survey_type,
    ):
        """Without a survey_type_id, zero rows come only from surveys whose
        type covers the species' group; surveys of unrelated types count only
        when they actually recorded the species."""
        from models import SpeciesType, SurveyTypeSpeciesTypeLink

        butterfly_type = create_survey_type(name="Butterfly")
        camera = create_survey_type(name="Camera Trap")
        fritillary = create_species(name="Marsh Fritillary", species_type="butterfly")
        butterfly_group = db_session.query(SpeciesType).filter(SpeciesType.name == "butterfly").one()
        db_session.add(SurveyTypeSpeciesTypeLink(
            survey_type_id=butterfly_type.id, species_type_id=butterfly_group.id,
        ))
        db_session.commit()

        seen = create_survey(survey_date=date(2024, 5, 1), survey_type_id=butterfly_type.id)
        none_seen = create_survey(survey_date=date(2024, 5, 8), survey_type_id=butterfly_type.id)
        camera_seen = create_survey(survey_date=date(2024, 5, 2), survey_type_id=camera.id)
        create_survey(survey_date=date(2024, 5, 3), survey_type_id=camera.id)  # excluded zero

        _add_sighting(client, auth_headers, seen.id, fritillary.id, 4)
        _add_sighting(client, auth_headers, camera_seen.id, fritillary.id, 2)

        data = client.get(
            f"/api/dashboard/species-occurrences?species_id={fritillary.id}",
            headers=auth_headers,
        ).json()["data"]
        assert [(d["survey_id"], d["occurrence_count"]) for d in data] == [
            (seen.id, 4),
            (camera_seen.id, 2),
            (none_seen.id, 0),
        ]


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


class TestSwardComposition:
    """Tests for GET /api/dashboard/sward-composition"""

    def test_requires_survey_type(self, client: TestClient, auth_headers: dict):
        response = client.get("/api/dashboard/sward-composition", headers=auth_headers)
        assert response.status_code == 422

    def test_returns_only_frequency_scored_sightings(
        self, client: TestClient, auth_headers: dict,
        create_species, create_survey, create_survey_type,
    ):
        """Plain count records of the same type stay out of the panel data."""
        botanical = create_survey_type(name="Botanical")
        scabious = create_species(name="Devil's-bit Scabious", species_type="butterfly")
        buttercup = create_species(name="Meadow Buttercup", species_type="butterfly")

        survey = create_survey(survey_date=date(2024, 6, 10), survey_type_id=botanical.id)
        resp = client.post(
            f"/api/surveys/{survey.id}/sightings",
            json={
                "species_id": scabious.id, "count": 1,
                "percent_frequency": 53.3, "frequency_band": "3",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        # A frequency-less sighting on the same survey is excluded.
        _add_sighting(client, auth_headers, survey.id, buttercup.id, 4)

        data = client.get(
            f"/api/dashboard/sward-composition?survey_type_id={botanical.id}",
            headers=auth_headers,
        ).json()
        assert len(data["rows"]) == 1
        row = data["rows"][0]
        assert row["species_id"] == scabious.id
        assert row["survey_date"] == "2024-06-10"
        assert float(row["percent_frequency"]) == 53.3
        assert row["frequency_band"] == "3"

    def test_scoped_to_survey_type(
        self, client: TestClient, auth_headers: dict,
        create_species, create_survey, create_survey_type,
    ):
        botanical = create_survey_type(name="Botanical")
        other = create_survey_type(name="Other")
        species = create_species(name="Saw-wort", species_type="butterfly")
        other_survey = create_survey(survey_date=date(2024, 6, 1), survey_type_id=other.id)
        resp = client.post(
            f"/api/surveys/{other_survey.id}/sightings",
            json={"species_id": species.id, "count": 1, "frequency_band": "+"},
            headers=auth_headers,
        )
        assert resp.status_code == 201

        data = client.get(
            f"/api/dashboard/sward-composition?survey_type_id={botanical.id}",
            headers=auth_headers,
        ).json()
        assert data["rows"] == []
