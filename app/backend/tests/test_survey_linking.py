"""
Tests for survey-to-slot linking: a recorded survey links to the open slot
whose window contains its date (same org and survey type).

Linking is non-destructive (the slot always survives) and idempotent — it is
re-run on create and on any edit of the fields that decide the link (date,
location), which is what fixes the old adoption model's date-edit bug.
"""

from datetime import date

from fastapi.testclient import TestClient

from models import ScheduledSurvey, ScheduledSurveyStatus


def _create_survey_via_api(client, auth_headers, *, survey_date, survey_type_id,
                           location_id=None, scheduled_survey_id=None):
    payload = {
        "date": survey_date,
        "survey_type_id": survey_type_id,
        "surveyor_ids": [],
    }
    if location_id is not None:
        payload["location_id"] = location_id
    if scheduled_survey_id is not None:
        payload["scheduled_survey_id"] = scheduled_survey_id
    return client.post("/api/surveys", json=payload, headers=auth_headers)


class TestLinkOnCreate:
    def test_fresh_survey_links_to_containing_open_slot(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        survey_type = create_survey_type(schedule_cadence="weekly")
        slot = create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )

        resp = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05", survey_type_id=survey_type.id
        )
        assert resp.status_code == 201
        assert resp.json()["scheduled_survey_id"] == slot.id

    def test_slot_survives_linking(
        self, client: TestClient, auth_headers: dict, db_session,
        create_survey_type, create_scheduled_survey
    ):
        """Linking never deletes anything — the old adoption model did."""
        survey_type = create_survey_type()
        slot = create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05", survey_type_id=survey_type.id
        )
        assert db_session.get(ScheduledSurvey, slot.id) is not None

    def test_no_link_outside_window(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        survey_type = create_survey_type()
        create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        resp = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-10", survey_type_id=survey_type.id
        )
        assert resp.json()["scheduled_survey_id"] is None

    def test_no_link_across_survey_types(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        slot_type = create_survey_type(name="Butterflies")
        other_type = create_survey_type(name="Birds")
        create_scheduled_survey(
            survey_type_id=slot_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        resp = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05", survey_type_id=other_type.id
        )
        assert resp.json()["scheduled_survey_id"] is None

    def test_no_link_across_organisations(
        self, client: TestClient, auth_headers: dict, db_session,
        create_survey_type, create_scheduled_survey
    ):
        from models import Organisation
        other_org = Organisation(name="Other", slug="other", is_active=True)
        db_session.add(other_org)
        db_session.commit()
        survey_type = create_survey_type()
        create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
            organisation_id=other_org.id,
        )
        resp = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05", survey_type_id=survey_type.id
        )
        assert resp.json()["scheduled_survey_id"] is None

    def test_day_precise_slot_links(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        """Single-day windows link like any other — non-destructive linking
        removed the old model's reason to exempt them."""
        survey_type = create_survey_type(schedule_cadence="date")
        slot = create_scheduled_survey(
            survey_type_id=survey_type.id, window_start=date(2026, 8, 3)
        )
        resp = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-03", survey_type_id=survey_type.id
        )
        assert resp.json()["scheduled_survey_id"] == slot.id

    def test_cancelled_slot_attracts_no_links(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        survey_type = create_survey_type()
        create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
            status=ScheduledSurveyStatus.cancelled,
        )
        resp = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05", survey_type_id=survey_type.id
        )
        assert resp.json()["scheduled_survey_id"] is None

    def test_two_surveys_link_to_the_same_slot(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        """Multiple surveys in one week all record the same slot — the old
        model could only ever attach one."""
        survey_type = create_survey_type(schedule_cadence="weekly")
        slot = create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        first = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-04", survey_type_id=survey_type.id
        )
        second = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-07", survey_type_id=survey_type.id
        )
        assert first.json()["scheduled_survey_id"] == slot.id
        assert second.json()["scheduled_survey_id"] == slot.id

        listed = client.get("/api/scheduled-surveys", headers=auth_headers).json()
        assert len(listed[0]["linked_surveys"]) == 2

    def test_location_match_preferred_over_other_location(
        self, client: TestClient, auth_headers: dict,
        create_survey_type, create_scheduled_survey, create_location
    ):
        survey_type = create_survey_type()
        here = create_location(name="Here")
        elsewhere = create_location(name="Elsewhere")
        create_scheduled_survey(
            survey_type_id=survey_type.id, location_id=elsewhere.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        matching = create_scheduled_survey(
            survey_type_id=survey_type.id, location_id=here.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        resp = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05",
            survey_type_id=survey_type.id, location_id=here.id,
        )
        assert resp.json()["scheduled_survey_id"] == matching.id

    def test_other_location_slot_still_linked_as_last_resort(
        self, client: TestClient, auth_headers: dict,
        create_survey_type, create_scheduled_survey, create_location
    ):
        """A location mismatch must not leave the week showing 'needs survey'."""
        survey_type = create_survey_type()
        here = create_location(name="Here")
        elsewhere = create_location(name="Elsewhere")
        slot = create_scheduled_survey(
            survey_type_id=survey_type.id, location_id=elsewhere.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        resp = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05",
            survey_type_id=survey_type.id, location_id=here.id,
        )
        assert resp.json()["scheduled_survey_id"] == slot.id


class TestExplicitLink:
    def test_explicit_slot_honored_even_outside_window(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        """The record flow may write up an overdue week after the window has
        passed; an explicit slot is accepted without window validation."""
        survey_type = create_survey_type(schedule_cadence="weekly")
        slot = create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 6, 1), window_end=date(2026, 6, 7),
        )
        resp = _create_survey_via_api(
            client, auth_headers, survey_date="2026-06-20",
            survey_type_id=survey_type.id, scheduled_survey_id=slot.id,
        )
        assert resp.status_code == 201
        assert resp.json()["scheduled_survey_id"] == slot.id

    def test_explicit_slot_rejected_for_wrong_type(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        slot = create_scheduled_survey(survey_type_id=create_survey_type(name="Butterflies").id)
        other_type = create_survey_type(name="Birds")
        resp = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05",
            survey_type_id=other_type.id, scheduled_survey_id=slot.id,
        )
        assert resp.status_code == 400

    def test_explicit_slot_rejected_cross_org(
        self, client: TestClient, auth_headers: dict, db_session,
        create_survey_type, create_scheduled_survey
    ):
        from models import Organisation
        other_org = Organisation(name="Other", slug="other", is_active=True)
        db_session.add(other_org)
        db_session.commit()
        survey_type = create_survey_type()
        foreign_slot = create_scheduled_survey(
            survey_type_id=survey_type.id, organisation_id=other_org.id
        )
        resp = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05",
            survey_type_id=survey_type.id, scheduled_survey_id=foreign_slot.id,
        )
        assert resp.status_code == 400


class TestRelinkOnUpdate:
    def test_date_edit_into_window_links(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        """THE original bug: a survey created with the wrong date and then
        corrected must pick up the week's slot."""
        survey_type = create_survey_type(schedule_cadence="weekly")
        slot = create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        created = _create_survey_via_api(
            client, auth_headers, survey_date="2026-07-01", survey_type_id=survey_type.id
        ).json()
        assert created["scheduled_survey_id"] is None

        resp = client.put(
            f"/api/surveys/{created['id']}",
            json={"date": "2026-08-05"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["scheduled_survey_id"] == slot.id

    def test_date_edit_out_of_window_unlinks(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        survey_type = create_survey_type(schedule_cadence="weekly")
        create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        created = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05", survey_type_id=survey_type.id
        ).json()
        assert created["scheduled_survey_id"] is not None

        resp = client.put(
            f"/api/surveys/{created['id']}",
            json={"date": "2026-09-01"},
            headers=auth_headers,
        )
        assert resp.json()["scheduled_survey_id"] is None

    def test_date_edit_between_windows_relinks(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        survey_type = create_survey_type(schedule_cadence="weekly")
        week_one = create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        week_two = create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 10), window_end=date(2026, 8, 16),
        )
        created = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05", survey_type_id=survey_type.id
        ).json()
        assert created["scheduled_survey_id"] == week_one.id

        resp = client.put(
            f"/api/surveys/{created['id']}",
            json={"date": "2026-08-12"},
            headers=auth_headers,
        )
        assert resp.json()["scheduled_survey_id"] == week_two.id

    def test_still_valid_link_is_kept_on_date_edit(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        """Moving the date within the same window keeps the same link."""
        survey_type = create_survey_type(schedule_cadence="weekly")
        slot = create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        created = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-04", survey_type_id=survey_type.id
        ).json()

        resp = client.put(
            f"/api/surveys/{created['id']}",
            json={"date": "2026-08-08"},
            headers=auth_headers,
        )
        assert resp.json()["scheduled_survey_id"] == slot.id

    def test_non_link_fields_do_not_relink(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        """Editing unrelated fields leaves an out-of-window explicit link
        alone (only date/location edits re-run linking)."""
        survey_type = create_survey_type(schedule_cadence="weekly")
        slot = create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 6, 1), window_end=date(2026, 6, 7),
        )
        created = _create_survey_via_api(
            client, auth_headers, survey_date="2026-06-20",
            survey_type_id=survey_type.id, scheduled_survey_id=slot.id,
        ).json()

        resp = client.put(
            f"/api/surveys/{created['id']}",
            json={"notes": "late write-up"},
            headers=auth_headers,
        )
        assert resp.json()["scheduled_survey_id"] == slot.id

    def test_deleting_linked_survey_reverts_slot_to_unfulfilled(
        self, client: TestClient, auth_headers: dict, create_survey_type, create_scheduled_survey
    ):
        survey_type = create_survey_type(schedule_cadence="weekly")
        create_scheduled_survey(
            survey_type_id=survey_type.id,
            window_start=date(2026, 8, 3), window_end=date(2026, 8, 9),
        )
        created = _create_survey_via_api(
            client, auth_headers, survey_date="2026-08-05", survey_type_id=survey_type.id
        ).json()

        assert client.delete(
            f"/api/surveys/{created['id']}", headers=auth_headers
        ).status_code == 204

        [slot_row] = client.get("/api/scheduled-surveys", headers=auth_headers).json()
        assert slot_row["linked_surveys"] == []
