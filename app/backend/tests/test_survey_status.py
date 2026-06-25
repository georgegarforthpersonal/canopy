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
