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

    def test_record_flow_sends_fields_and_status_together(
        self, client: TestClient, auth_headers: dict, create_surveyor
    ):
        """The record flow saves the survey data and the explicit completed
        status in one PUT."""
        surveyor = create_surveyor()
        created = client.post(
            "/api/surveys",
            json={"date": "2026-12-01", "status": "scheduled", "surveyor_ids": []},
            headers=auth_headers,
        ).json()

        resp = client.put(
            f"/api/surveys/{created['id']}",
            json={
                "date": "2026-12-03",
                "sun_percentage": 80,
                "surveyor_ids": [surveyor.id],
                "status": "completed",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "completed"
        assert body["surveyor_ids"] == [surveyor.id]

    def test_editing_details_keeps_survey_scheduled(
        self, client: TestClient, auth_headers: dict
    ):
        """Editing a scheduled survey's fields never records it — the
        scheduled → completed transition only happens on an explicit
        status in the payload (the record flow sends it)."""
        created = client.post(
            "/api/surveys",
            json={"date": "2026-12-01", "status": "scheduled", "surveyor_ids": []},
            headers=auth_headers,
        ).json()

        resp = client.put(
            f"/api/surveys/{created['id']}",
            json={"date": "2026-12-02", "sun_percentage": 50, "notes": "moved a day"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "scheduled"

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

    def test_schedule_rejects_unknown_survey_type(
        self, client: TestClient, auth_headers: dict
    ):
        """An invalid survey_type_id is a 404, not a silent cadence fallback."""
        resp = client.post(
            "/api/surveys/schedule",
            json={"survey_type_id": 99999, "dates": ["2026-12-01"]},
            headers=auth_headers,
        )
        assert resp.status_code == 404
        # Nothing was created
        scheduled = client.get(
            "/api/surveys?survey_status=scheduled", headers=auth_headers
        ).json()
        assert scheduled["total"] == 0

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

    def test_fresh_completed_survey_adopts_open_weekly_slot(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_surveyor
    ):
        """A survey entered via "new survey" whose date falls inside an open
        weekly slot's window records that week: it adopts the slot's window
        and the placeholder is removed."""
        surveyor = create_surveyor()
        survey_type = create_survey_type(name="Butterflies", schedule_cadence="weekly")
        client.post(
            "/api/surveys/schedule",
            json={"survey_type_id": survey_type.id, "dates": ["2026-06-01"]},
            headers=auth_headers,
        )

        resp = client.post(
            "/api/surveys",
            json={
                "date": "2026-06-04",
                "survey_type_id": survey_type.id,
                "surveyor_ids": [surveyor.id],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["status"] == "completed"
        assert body["scheduled_window_start"] == "2026-06-01"
        assert body["scheduled_window_end"] == "2026-06-07"

        scheduled = client.get("/api/surveys?survey_status=scheduled", headers=auth_headers).json()
        assert scheduled["total"] == 0
        completed = client.get("/api/surveys?survey_status=completed", headers=auth_headers).json()
        assert completed["total"] == 1

    def test_adopting_slot_keeps_actual_surveyors(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_surveyor
    ):
        """The recorded survey keeps the people who actually did it, not the
        slot's pre-assigned sign-ups (whose associations must not linger)."""
        assigned = create_surveyor()
        actual = create_surveyor()
        survey_type = create_survey_type(name="Butterflies", schedule_cadence="weekly")
        client.post(
            "/api/surveys/schedule",
            json={
                "survey_type_id": survey_type.id,
                "surveyor_ids": [assigned.id],
                "dates": ["2026-06-01"],
            },
            headers=auth_headers,
        )

        resp = client.post(
            "/api/surveys",
            json={
                "date": "2026-06-04",
                "survey_type_id": survey_type.id,
                "surveyor_ids": [actual.id],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["surveyor_ids"] == [actual.id]

    def test_no_adoption_outside_window(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """A completed survey dated outside every open window stays unlinked
        and the slot keeps waiting."""
        survey_type = create_survey_type(name="Butterflies", schedule_cadence="weekly")
        client.post(
            "/api/surveys/schedule",
            json={"survey_type_id": survey_type.id, "dates": ["2026-06-01"]},
            headers=auth_headers,
        )

        resp = client.post(
            "/api/surveys",
            json={"date": "2026-06-09", "survey_type_id": survey_type.id, "surveyor_ids": []},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["scheduled_window_start"] is None

        scheduled = client.get("/api/surveys?survey_status=scheduled", headers=auth_headers).json()
        assert scheduled["total"] == 1

    def test_no_adoption_across_survey_types(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """A survey of another type never records a different type's slot."""
        butterflies = create_survey_type(name="Butterflies", schedule_cadence="weekly")
        moths = create_survey_type(name="Moths", schedule_cadence="weekly")
        client.post(
            "/api/surveys/schedule",
            json={"survey_type_id": butterflies.id, "dates": ["2026-06-01"]},
            headers=auth_headers,
        )

        resp = client.post(
            "/api/surveys",
            json={"date": "2026-06-04", "survey_type_id": moths.id, "surveyor_ids": []},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["scheduled_window_start"] is None

        scheduled = client.get("/api/surveys?survey_status=scheduled", headers=auth_headers).json()
        assert scheduled["total"] == 1

    def test_scheduled_create_never_adopts(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """Creating another scheduled survey inside the window must not
        swallow the existing slot — only recorded (completed) surveys do."""
        survey_type = create_survey_type(name="Butterflies", schedule_cadence="weekly")
        client.post(
            "/api/surveys/schedule",
            json={"survey_type_id": survey_type.id, "dates": ["2026-06-01"]},
            headers=auth_headers,
        )

        resp = client.post(
            "/api/surveys",
            json={
                "date": "2026-06-04",
                "status": "scheduled",
                "survey_type_id": survey_type.id,
                "surveyor_ids": [],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201

        scheduled = client.get("/api/surveys?survey_status=scheduled", headers=auth_headers).json()
        assert scheduled["total"] == 2

    def test_day_precise_slots_are_never_adopted(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """Date-cadence slots have no window; a completed survey on the same
        day is a legitimate extra survey and must not consume the slot."""
        survey_type = create_survey_type(name="Birds", schedule_cadence="date")
        client.post(
            "/api/surveys/schedule",
            json={"survey_type_id": survey_type.id, "dates": ["2026-06-01"]},
            headers=auth_headers,
        )

        resp = client.post(
            "/api/surveys",
            json={"date": "2026-06-01", "survey_type_id": survey_type.id, "surveyor_ids": []},
            headers=auth_headers,
        )
        assert resp.status_code == 201

        scheduled = client.get("/api/surveys?survey_status=scheduled", headers=auth_headers).json()
        assert scheduled["total"] == 1

    def test_only_one_slot_adopted_per_week(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        """Two surveys in the same week: the first records the slot, the
        second is an ordinary extra survey."""
        survey_type = create_survey_type(name="Butterflies", schedule_cadence="weekly")
        client.post(
            "/api/surveys/schedule",
            json={"survey_type_id": survey_type.id, "dates": ["2026-06-01"]},
            headers=auth_headers,
        )

        first = client.post(
            "/api/surveys",
            json={"date": "2026-06-02", "survey_type_id": survey_type.id, "surveyor_ids": []},
            headers=auth_headers,
        ).json()
        second = client.post(
            "/api/surveys",
            json={"date": "2026-06-03", "survey_type_id": survey_type.id, "surveyor_ids": []},
            headers=auth_headers,
        ).json()

        assert first["scheduled_window_start"] == "2026-06-01"
        assert second["scheduled_window_start"] is None
        completed = client.get("/api/surveys?survey_status=completed", headers=auth_headers).json()
        assert completed["total"] == 2

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
