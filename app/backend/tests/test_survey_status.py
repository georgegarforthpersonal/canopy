"""
Tests for the survey lifecycle status (scheduled / completed / cancelled).

The status is explicit so that a completed survey with a nil count of zero is
not mistaken for an unrecorded one, and so scheduled surveys (volunteers signed
up, not yet carried out) are distinguishable.
"""

from fastapi.testclient import TestClient


class TestSurveyStatusDefaults:
    def test_create_defaults_to_completed(self, client: TestClient, auth_headers: dict, create_surveyor):
        """A survey created without a status is treated as completed (recorded)."""
        surveyor = create_surveyor()
        resp = client.post(
            "/api/surveys",
            json={"date": "2024-07-01", "surveyor_ids": [surveyor.id]},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "completed"

    def test_create_scheduled(self, client: TestClient, auth_headers: dict, create_surveyor):
        """A scheduled (future) survey can be created explicitly."""
        surveyor = create_surveyor()
        resp = client.post(
            "/api/surveys",
            json={"date": "2026-12-01", "status": "scheduled", "surveyor_ids": [surveyor.id]},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "scheduled"

    def test_create_rejects_unknown_status(self, client: TestClient, auth_headers: dict):
        resp = client.post(
            "/api/surveys",
            json={"date": "2026-12-01", "status": "bogus", "surveyor_ids": []},
            headers=auth_headers,
        )
        assert resp.status_code == 422


class TestSurveyStatusTransitions:
    def test_complete_a_scheduled_survey(self, client: TestClient, auth_headers: dict):
        """A scheduled survey can be marked completed via update (even nil count)."""
        created = client.post(
            "/api/surveys",
            json={"date": "2026-12-01", "status": "scheduled", "surveyor_ids": []},
            headers=auth_headers,
        ).json()

        resp = client.put(
            f"/api/surveys/{created['id']}",
            json={"status": "completed"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "completed"

    def test_saving_details_completes_a_scheduled_survey(
        self, client: TestClient, auth_headers: dict
    ):
        """Saving a scheduled survey's details records it (even a nil count),
        without the client having to send status explicitly."""
        created = client.post(
            "/api/surveys",
            json={"date": "2026-12-01", "status": "scheduled", "surveyor_ids": []},
            headers=auth_headers,
        ).json()

        resp = client.put(
            f"/api/surveys/{created['id']}",
            json={"date": "2026-12-01", "sun_percentage": 50},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "completed"

    def test_assigning_surveyors_keeps_survey_scheduled(
        self, client: TestClient, auth_headers: dict, create_surveyor
    ):
        """Assigning surveyors to an upcoming survey must not complete it."""
        surveyor = create_surveyor()
        created = client.post(
            "/api/surveys",
            json={"date": "2026-12-01", "status": "scheduled", "surveyor_ids": []},
            headers=auth_headers,
        ).json()

        resp = client.put(
            f"/api/surveys/{created['id']}",
            json={"surveyor_ids": [surveyor.id]},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "scheduled"

    def test_status_persists_on_get(self, client: TestClient, auth_headers: dict):
        created = client.post(
            "/api/surveys",
            json={"date": "2026-12-01", "status": "scheduled", "surveyor_ids": []},
            headers=auth_headers,
        ).json()
        resp = client.get(f"/api/surveys/{created['id']}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "scheduled"


class TestSurveyStatusFilter:
    def test_filter_by_status(self, client: TestClient, auth_headers: dict):
        client.post(
            "/api/surveys",
            json={"date": "2024-01-01", "status": "completed", "surveyor_ids": []},
            headers=auth_headers,
        )
        client.post(
            "/api/surveys",
            json={"date": "2026-12-01", "status": "scheduled", "surveyor_ids": []},
            headers=auth_headers,
        )

        scheduled = client.get("/api/surveys?survey_status=scheduled", headers=auth_headers).json()
        assert scheduled["total"] == 1
        assert all(s["status"] == "scheduled" for s in scheduled["data"])

        completed = client.get("/api/surveys?survey_status=completed", headers=auth_headers).json()
        assert completed["total"] == 1
        assert all(s["status"] == "completed" for s in completed["data"])

    def test_list_includes_status(self, client: TestClient, auth_headers: dict):
        client.post(
            "/api/surveys",
            json={"date": "2024-01-01", "surveyor_ids": []},
            headers=auth_headers,
        )
        data = client.get("/api/surveys", headers=auth_headers).json()
        assert data["total"] == 1
        assert data["data"][0]["status"] == "completed"


class TestScheduleSurveys:
    def test_schedule_series_creates_one_per_date(
        self, client: TestClient, auth_headers: dict, create_surveyor
    ):
        """A recurring series creates one scheduled survey per date, all assigned."""
        surveyor = create_surveyor()
        resp = client.post(
            "/api/surveys/schedule",
            json={
                "surveyor_ids": [surveyor.id],
                "dates": ["2026-12-01", "2026-12-08", "2026-12-15"],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        created = resp.json()
        assert len(created) == 3
        assert {s["date"] for s in created} == {"2026-12-01", "2026-12-08", "2026-12-15"}
        assert all(s["status"] == "scheduled" for s in created)
        assert all(s["surveyor_ids"] == [surveyor.id] for s in created)

        scheduled = client.get("/api/surveys?survey_status=scheduled", headers=auth_headers).json()
        assert scheduled["total"] == 3

    def test_schedule_without_surveyors(self, client: TestClient, auth_headers: dict):
        """Surveys can be scheduled with no surveyors yet (sign-up later)."""
        resp = client.post(
            "/api/surveys/schedule",
            json={"dates": ["2026-12-01"]},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        created = resp.json()
        assert len(created) == 1
        assert created[0]["surveyor_ids"] == []

    def test_schedule_rejects_empty_dates(self, client: TestClient, auth_headers: dict):
        resp = client.post(
            "/api/surveys/schedule",
            json={"dates": []},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    def test_date_cadence_has_no_window(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """A specific-day survey type schedules with no window (day-precise)."""
        survey_type = create_survey_type(name="Birds", schedule_cadence="date")
        resp = client.post(
            "/api/surveys/schedule",
            json={"survey_type_id": survey_type.id, "dates": ["2026-12-01"]},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        created = resp.json()[0]
        assert created["scheduled_window_start"] is None
        assert created["scheduled_window_end"] is None

    def test_weekly_cadence_sets_seven_day_window(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """A weekly survey type schedules each date as a Mon-anchored 7-day window."""
        survey_type = create_survey_type(name="Butterflies", schedule_cadence="weekly")
        resp = client.post(
            "/api/surveys/schedule",
            json={"survey_type_id": survey_type.id, "dates": ["2026-06-01", "2026-06-08"]},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        created = sorted(resp.json(), key=lambda s: s["date"])

        assert created[0]["date"] == "2026-06-01"
        assert created[0]["scheduled_window_start"] == "2026-06-01"
        assert created[0]["scheduled_window_end"] == "2026-06-07"  # start + 6 days
        # Consecutive windows tile without gaps or overlap.
        assert created[1]["scheduled_window_start"] == "2026-06-08"
        assert created[1]["scheduled_window_end"] == "2026-06-14"

    def test_weekly_window_surfaces_on_list(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """The scheduling window is returned by the survey list endpoint."""
        survey_type = create_survey_type(name="Butterflies", schedule_cadence="weekly")
        client.post(
            "/api/surveys/schedule",
            json={"survey_type_id": survey_type.id, "dates": ["2026-06-01"]},
            headers=auth_headers,
        )
        listed = client.get("/api/surveys?survey_status=scheduled", headers=auth_headers).json()
        row = listed["data"][0]
        assert row["scheduled_window_start"] == "2026-06-01"
        assert row["scheduled_window_end"] == "2026-06-07"
