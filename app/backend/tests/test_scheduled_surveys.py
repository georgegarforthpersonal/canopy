"""
Tests for the scheduled-surveys router: slots (plans) that recorded surveys
link to. Fulfilment is derived from the linked surveys embedded in every read.
"""

from fastapi.testclient import TestClient

from models import ScheduledSurvey, ScheduledSurveyStatus, Survey


class TestScheduleSeries:
    def test_weekly_cadence_sets_seven_day_window(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        survey_type = create_survey_type(schedule_cadence="weekly")
        resp = client.post(
            "/api/scheduled-surveys/schedule",
            json={"survey_type_id": survey_type.id, "dates": ["2026-08-03", "2026-08-10"]},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        slots = resp.json()
        assert [s["window_start"] for s in slots] == ["2026-08-03", "2026-08-10"]
        assert [s["window_end"] for s in slots] == ["2026-08-09", "2026-08-16"]
        assert all(s["status"] == "open" for s in slots)
        assert all(s["linked_surveys"] == [] for s in slots)

    def test_date_cadence_windows_are_single_days(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        survey_type = create_survey_type(schedule_cadence="date")
        resp = client.post(
            "/api/scheduled-surveys/schedule",
            json={"survey_type_id": survey_type.id, "dates": ["2026-08-03"]},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        slot = resp.json()[0]
        assert slot["window_start"] == slot["window_end"] == "2026-08-03"

    def test_series_shares_surveyors_and_notes(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_surveyor
    ):
        survey_type = create_survey_type(schedule_cadence="weekly")
        surveyor = create_surveyor()
        resp = client.post(
            "/api/scheduled-surveys/schedule",
            json={
                "survey_type_id": survey_type.id,
                "surveyor_ids": [surveyor.id],
                "notes": "north transect",
                "dates": ["2026-08-03", "2026-08-10"],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert all(s["surveyor_ids"] == [surveyor.id] for s in resp.json())
        assert all(s["notes"] == "north transect" for s in resp.json())

    def test_schedule_rejects_unknown_survey_type(self, client: TestClient, auth_headers: dict):
        resp = client.post(
            "/api/scheduled-surveys/schedule",
            json={"survey_type_id": 99999, "dates": ["2026-08-03"]},
            headers=auth_headers,
        )
        assert resp.status_code == 404

    def test_schedule_requires_survey_type(self, client: TestClient, auth_headers: dict):
        resp = client.post(
            "/api/scheduled-surveys/schedule",
            json={"dates": ["2026-08-03"]},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    def test_schedule_rejects_empty_dates(
        self, client: TestClient, auth_headers: dict, create_survey_type
    ):
        resp = client.post(
            "/api/scheduled-surveys/schedule",
            json={"survey_type_id": create_survey_type().id, "dates": []},
            headers=auth_headers,
        )
        assert resp.status_code == 422


class TestListScheduledSurveys:
    def test_list_embeds_linked_surveys(
        self, client: TestClient, auth_headers: dict,
        create_survey_type, create_scheduled_survey, create_survey
    ):
        from datetime import date
        survey_type = create_survey_type(schedule_cadence="weekly")
        slot = create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        survey = create_survey(
            survey_date=date(2026, 8, 5),
            survey_type_id=survey_type.id,
            scheduled_survey_id=slot.id,
        )

        resp = client.get("/api/scheduled-surveys", headers=auth_headers)
        assert resp.status_code == 200
        [row] = resp.json()
        assert row["id"] == slot.id
        assert row["linked_surveys"] == [{"id": survey.id, "date": "2026-08-05"}]

    def test_list_filters_by_type_and_status(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        type_a = create_survey_type(name="Butterflies")
        type_b = create_survey_type(name="Birds")
        create_scheduled_survey(survey_type_id=type_a.id)
        cancelled = create_scheduled_survey(
            survey_type_id=type_b.id, status=ScheduledSurveyStatus.cancelled
        )

        by_type = client.get(
            f"/api/scheduled-surveys?survey_type_id={type_a.id}", headers=auth_headers
        ).json()
        assert len(by_type) == 1 and by_type[0]["survey_type_id"] == type_a.id

        by_status = client.get(
            "/api/scheduled-surveys?status=cancelled", headers=auth_headers
        ).json()
        assert [s["id"] for s in by_status] == [cancelled.id]

    def test_list_is_org_scoped(
        self, client: TestClient, auth_headers: dict, db_session,
        create_survey_type, create_scheduled_survey
    ):
        from models import Organisation
        other_org = Organisation(name="Other", slug="other", is_active=True)
        db_session.add(other_org)
        db_session.commit()
        create_scheduled_survey(
            survey_type_id=create_survey_type().id, organisation_id=other_org.id
        )

        resp = client.get("/api/scheduled-surveys", headers=auth_headers)
        assert resp.json() == []

    def test_get_single_slot(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        slot = create_scheduled_survey(survey_type_id=create_survey_type().id)
        resp = client.get(f"/api/scheduled-surveys/{slot.id}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == slot.id

    def test_get_unknown_slot_404(self, client: TestClient, auth_headers: dict):
        assert client.get("/api/scheduled-surveys/99999", headers=auth_headers).status_code == 404


class TestUpdateScheduledSurvey:
    def test_cancel_keeps_linked_surveys(
        self, client: TestClient, auth_headers: dict, db_session,
        create_survey_type, create_scheduled_survey, create_survey
    ):
        survey_type = create_survey_type()
        slot = create_scheduled_survey(survey_type_id=survey_type.id)
        survey = create_survey(survey_type_id=survey_type.id, scheduled_survey_id=slot.id)

        resp = client.put(
            f"/api/scheduled-surveys/{slot.id}",
            json={"status": "cancelled"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"
        db_session.refresh(survey)
        assert survey.scheduled_survey_id == slot.id

    def test_update_replaces_surveyors(
        self, client: TestClient, auth_headers: dict,
        create_survey_type, create_scheduled_survey, create_surveyor
    ):
        first = create_surveyor(first_name="First")
        second = create_surveyor(first_name="Second")
        slot = create_scheduled_survey(
            survey_type_id=create_survey_type().id, surveyor_ids=[first.id]
        )

        resp = client.put(
            f"/api/scheduled-surveys/{slot.id}",
            json={"surveyor_ids": [second.id]},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["surveyor_ids"] == [second.id]

    def test_update_notes_only(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        slot = create_scheduled_survey(survey_type_id=create_survey_type().id)
        resp = client.put(
            f"/api/scheduled-surveys/{slot.id}",
            json={"notes": "meet at the gate"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["notes"] == "meet at the gate"
        assert resp.json()["status"] == "open"


class TestDeleteScheduledSurvey:
    def test_delete_detaches_linked_survey(
        self, client: TestClient, auth_headers: dict, db_session,
        create_survey_type, create_scheduled_survey, create_survey
    ):
        """Deleting a slot never deletes recorded surveys — they detach."""
        survey_type = create_survey_type()
        slot = create_scheduled_survey(survey_type_id=survey_type.id)
        survey = create_survey(survey_type_id=survey_type.id, scheduled_survey_id=slot.id)

        resp = client.delete(f"/api/scheduled-surveys/{slot.id}", headers=auth_headers)
        assert resp.status_code == 204
        assert db_session.get(ScheduledSurvey, slot.id) is None

        db_session.expire_all()
        survivor = db_session.get(Survey, survey.id)
        assert survivor is not None
        assert survivor.scheduled_survey_id is None

    def test_delete_removes_preassignments(
        self, client: TestClient, auth_headers: dict, db_session,
        create_survey_type, create_scheduled_survey, create_surveyor
    ):
        from models import ScheduledSurveySurveyor
        slot = create_scheduled_survey(
            survey_type_id=create_survey_type().id, surveyor_ids=[create_surveyor().id]
        )
        assert client.delete(
            f"/api/scheduled-surveys/{slot.id}", headers=auth_headers
        ).status_code == 204
        remaining = db_session.query(ScheduledSurveySurveyor).filter(
            ScheduledSurveySurveyor.scheduled_survey_id == slot.id
        ).count()
        assert remaining == 0
