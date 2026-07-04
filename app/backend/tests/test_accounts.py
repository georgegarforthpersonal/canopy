"""
Tests for user accounts: login, roles, invites, password reset,
user management and survey self-signup.
"""

from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from models import Invite, Surveyor, SurveySurveyor, User, UserRole


def _token_from_url(url: str) -> str:
    return parse_qs(urlparse(url).query)["token"][0]


# ============================================================================
# Login / sessions
# ============================================================================

class TestUserLogin:
    def test_login_success(self, client: TestClient, create_user):
        create_user(email="jane@example.org", password="a-strong-password", role=UserRole.editor)
        response = client.post(
            "/api/auth/login",
            json={"email": "jane@example.org", "password": "a-strong-password"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["authenticated"] is True
        assert data["user"]["role"] == "editor"
        assert "token" in data

    def test_login_is_case_insensitive_on_email(self, client: TestClient, create_user):
        create_user(email="jane@example.org", password="a-strong-password")
        response = client.post(
            "/api/auth/login",
            json={"email": "Jane@Example.org", "password": "a-strong-password"},
        )
        assert response.status_code == 200

    def test_login_wrong_password(self, client: TestClient, create_user):
        create_user(email="jane@example.org", password="a-strong-password")
        response = client.post(
            "/api/auth/login",
            json={"email": "jane@example.org", "password": "wrong"},
        )
        assert response.status_code == 401

    def test_login_unknown_email_same_error(self, client: TestClient, create_user):
        create_user(email="jane@example.org", password="a-strong-password")
        wrong_pw = client.post(
            "/api/auth/login", json={"email": "jane@example.org", "password": "wrong"}
        )
        unknown = client.post(
            "/api/auth/login", json={"email": "nobody@example.org", "password": "wrong"}
        )
        # No account enumeration: identical error either way
        assert wrong_pw.status_code == unknown.status_code == 401
        assert wrong_pw.json()["detail"] == unknown.json()["detail"]

    def test_login_inactive_user(self, client: TestClient, create_user):
        create_user(email="jane@example.org", password="a-strong-password", is_active=False)
        response = client.post(
            "/api/auth/login",
            json={"email": "jane@example.org", "password": "a-strong-password"},
        )
        assert response.status_code == 401

    def test_login_rate_limited(self, client: TestClient, create_user):
        create_user(email="jane@example.org", password="a-strong-password")
        for _ in range(10):
            client.post("/api/auth/login", json={"email": "jane@example.org", "password": "wrong"})
        response = client.post(
            "/api/auth/login",
            json={"email": "jane@example.org", "password": "a-strong-password"},
        )
        assert response.status_code == 429

    def test_session_token_works_and_logout_revokes_it(self, client: TestClient, login_as):
        headers, user = login_as(UserRole.viewer)
        assert client.get("/api/surveyors", headers=headers).status_code == 200

        client.post("/api/auth/logout", headers=headers)
        assert client.get("/api/surveyors", headers=headers).status_code == 401


class TestMe:
    def test_me_user(self, client: TestClient, login_as):
        headers, user = login_as(UserRole.editor)
        data = client.get("/api/auth/me", headers=headers).json()
        assert data["authenticated"] is True
        assert data["role"] == "editor"
        assert data["user"]["email"] == user.email

    def test_me_anonymous(self, client: TestClient, test_org):
        data = client.get("/api/auth/me").json()
        assert data["authenticated"] is False
        assert data["organisation"]["slug"] == test_org.slug


# ============================================================================
# Role enforcement
# ============================================================================

class TestRoleEnforcement:
    def test_reads_require_login(self, client: TestClient):
        assert client.get("/api/surveyors").status_code == 401
        assert client.get("/api/surveys").status_code == 401
        assert client.get("/api/species").status_code == 401

    def test_viewer_can_read(self, client: TestClient, login_as):
        headers, _ = login_as(UserRole.viewer)
        assert client.get("/api/surveyors", headers=headers).status_code == 200
        assert client.get("/api/surveys", headers=headers).status_code == 200

    def test_viewer_cannot_write(self, client: TestClient, login_as):
        headers, _ = login_as(UserRole.viewer)
        response = client.post(
            "/api/surveyors", json={"first_name": "New", "last_name": "Person"}, headers=headers
        )
        assert response.status_code == 403

    def test_editor_can_create_surveyor_but_not_devices(self, client: TestClient, login_as):
        headers, _ = login_as(UserRole.editor)
        created = client.post(
            "/api/surveyors", json={"first_name": "New", "last_name": "Person"}, headers=headers
        )
        assert created.status_code == 201

        device = client.post(
            "/api/devices",
            json={"name": "Cam", "device_type": "camera_trap", "latitude": 51.0, "longitude": -2.0},
            headers=headers,
        )
        assert device.status_code == 403

    def test_admin_can_manage_devices(self, client: TestClient, login_as):
        headers, _ = login_as(UserRole.admin)
        device = client.post(
            "/api/devices",
            json={"name": "Cam", "device_type": "camera_trap", "latitude": 51.0, "longitude": -2.0},
            headers=headers,
        )
        assert device.status_code == 201


# ============================================================================
# Invites
# ============================================================================

class TestInvites:
    def _invite(self, client, headers, email="new@example.org", role="viewer"):
        response = client.post(
            "/api/auth/invites", json={"email": email, "role": role}, headers=headers
        )
        assert response.status_code == 201, response.text
        return response.json()

    def test_invite_requires_admin(self, client: TestClient, login_as):
        headers, _ = login_as(UserRole.editor)
        response = client.post(
            "/api/auth/invites", json={"email": "x@example.org", "role": "viewer"}, headers=headers
        )
        assert response.status_code == 403

    def test_invite_and_accept_flow(self, client: TestClient, login_as):
        admin_headers, _ = login_as(UserRole.admin)
        invited = self._invite(client, admin_headers, email="new@example.org", role="editor")
        assert invited["invite"]["role"] == "editor"
        # Link is returned so admins can share it manually if email is not set up
        token = _token_from_url(invited["invite_url"])

        looked_up = client.get(f"/api/auth/invites/lookup?token={token}")
        assert looked_up.status_code == 200
        assert looked_up.json()["email"] == "new@example.org"

        accepted = client.post(
            "/api/auth/accept-invite",
            json={"token": token, "first_name": "Nell", "last_name": "Woods", "password": "a-strong-password"},
        )
        assert accepted.status_code == 200
        data = accepted.json()
        assert data["user"]["role"] == "editor"

        # The new account can log in and act as an editor
        session_headers = {"Authorization": f"Bearer {data['token']}"}
        created = client.post(
            "/api/surveyors", json={"first_name": "A", "last_name": "B"}, headers=session_headers
        )
        assert created.status_code == 201

    def test_invite_is_single_use(self, client: TestClient, login_as):
        admin_headers, _ = login_as(UserRole.admin)
        token = _token_from_url(self._invite(client, admin_headers)["invite_url"])
        first = client.post(
            "/api/auth/accept-invite",
            json={"token": token, "first_name": "A", "password": "a-strong-password"},
        )
        assert first.status_code == 200
        second = client.post(
            "/api/auth/accept-invite",
            json={"token": token, "first_name": "B", "password": "a-strong-password"},
        )
        assert second.status_code == 404

    def test_expired_invite_rejected(self, client: TestClient, login_as, db_session):
        admin_headers, _ = login_as(UserRole.admin)
        token = _token_from_url(self._invite(client, admin_headers)["invite_url"])
        invite = db_session.query(Invite).order_by(Invite.id.desc()).first()
        invite.expires_at = datetime.utcnow() - timedelta(hours=1)
        db_session.add(invite)
        db_session.commit()

        response = client.post(
            "/api/auth/accept-invite",
            json={"token": token, "first_name": "A", "password": "a-strong-password"},
        )
        assert response.status_code == 404

    def test_invite_existing_user_conflicts(self, client: TestClient, login_as, create_user):
        admin_headers, _ = login_as(UserRole.admin)
        create_user(email="taken@example.org")
        response = client.post(
            "/api/auth/invites",
            json={"email": "taken@example.org", "role": "viewer"},
            headers=admin_headers,
        )
        assert response.status_code == 409

    def test_weak_password_rejected_on_accept(self, client: TestClient, login_as):
        admin_headers, _ = login_as(UserRole.admin)
        token = _token_from_url(self._invite(client, admin_headers)["invite_url"])
        response = client.post(
            "/api/auth/accept-invite",
            json={"token": token, "first_name": "A", "password": "short"},
        )
        assert response.status_code == 422

    def test_revoke_invite(self, client: TestClient, login_as):
        admin_headers, _ = login_as(UserRole.admin)
        invited = self._invite(client, admin_headers)
        invite_id = invited["invite"]["id"]
        token = _token_from_url(invited["invite_url"])

        assert client.delete(f"/api/auth/invites/{invite_id}", headers=admin_headers).status_code == 204
        assert client.get(f"/api/auth/invites/lookup?token={token}").status_code == 404

    def test_reinviting_replaces_open_invite(self, client: TestClient, login_as):
        admin_headers, _ = login_as(UserRole.admin)
        first_token = _token_from_url(self._invite(client, admin_headers)["invite_url"])
        second_token = _token_from_url(self._invite(client, admin_headers)["invite_url"])

        assert client.get(f"/api/auth/invites/lookup?token={first_token}").status_code == 404
        assert client.get(f"/api/auth/invites/lookup?token={second_token}").status_code == 200


# ============================================================================
# Password reset
# ============================================================================

class TestPasswordReset:
    def test_request_always_200(self, client: TestClient, test_org):
        response = client.post(
            "/api/auth/request-password-reset", json={"email": "nobody@example.org"}
        )
        assert response.status_code == 200

    def test_reset_flow(self, client: TestClient, create_user, db_session):
        user = create_user(email="jane@example.org", password="old-password-123")
        assert client.post(
            "/api/auth/request-password-reset", json={"email": "jane@example.org"}
        ).status_code == 200

        # The raw token is only emailed; recreate it via the stored hash by
        # setting a known token directly (unit-level shortcut).
        from auth import generate_token, hash_token
        token = generate_token()
        db_session.refresh(user)
        user.password_reset_token_hash = hash_token(token)
        db_session.add(user)
        db_session.commit()

        response = client.post(
            "/api/auth/reset-password", json={"token": token, "password": "new-password-123"}
        )
        assert response.status_code == 200

        # Old password no longer works; new one does
        assert client.post(
            "/api/auth/login", json={"email": "jane@example.org", "password": "old-password-123"}
        ).status_code == 401
        assert client.post(
            "/api/auth/login", json={"email": "jane@example.org", "password": "new-password-123"}
        ).status_code == 200

    def test_reset_token_single_use(self, client: TestClient, create_user, db_session):
        from auth import generate_token, hash_token
        user = create_user(email="jane@example.org")
        token = generate_token()
        user.password_reset_token_hash = hash_token(token)
        user.password_reset_expires_at = datetime.utcnow() + timedelta(minutes=30)
        db_session.add(user)
        db_session.commit()

        assert client.post(
            "/api/auth/reset-password", json={"token": token, "password": "new-password-123"}
        ).status_code == 200
        assert client.post(
            "/api/auth/reset-password", json={"token": token, "password": "other-password-123"}
        ).status_code == 400

    def test_reset_revokes_existing_sessions(self, client: TestClient, login_as, db_session):
        from auth import generate_token, hash_token
        headers, user = login_as(UserRole.viewer)
        token = generate_token()
        user.password_reset_token_hash = hash_token(token)
        user.password_reset_expires_at = datetime.utcnow() + timedelta(minutes=30)
        db_session.add(user)
        db_session.commit()

        client.post("/api/auth/reset-password", json={"token": token, "password": "new-password-123"})
        # Drop the fresh session cookie the reset response set on the client,
        # so this asserts on the old Bearer token alone
        client.cookies.clear()
        assert client.get("/api/surveyors", headers=headers).status_code == 401


class TestChangePassword:
    def test_change_password(self, client: TestClient, login_as):
        headers, user = login_as(UserRole.viewer, password="old-password-123")
        response = client.post(
            "/api/auth/change-password",
            json={"current_password": "old-password-123", "new_password": "new-password-123"},
            headers=headers,
        )
        assert response.status_code == 200
        # Old session is revoked; the response's new token works. Clear the
        # cookie jar first so the old Bearer token is the only credential.
        client.cookies.clear()
        assert client.get("/api/surveyors", headers=headers).status_code == 401
        new_headers = {"Authorization": f"Bearer {response.json()['token']}"}
        assert client.get("/api/surveyors", headers=new_headers).status_code == 200

    def test_change_password_wrong_current(self, client: TestClient, login_as):
        headers, _ = login_as(UserRole.viewer, password="old-password-123")
        response = client.post(
            "/api/auth/change-password",
            json={"current_password": "wrong", "new_password": "new-password-123"},
            headers=headers,
        )
        assert response.status_code == 401


# ============================================================================
# User management
# ============================================================================

class TestUserManagement:
    def test_list_users_admin_only(self, client: TestClient, login_as):
        editor_headers, _ = login_as(UserRole.editor)
        assert client.get("/api/auth/users", headers=editor_headers).status_code == 403

        admin_headers, _ = login_as(UserRole.admin)
        response = client.get("/api/auth/users", headers=admin_headers)
        assert response.status_code == 200
        assert len(response.json()) == 2

    def test_change_role(self, client: TestClient, login_as, create_user):
        admin_headers, _ = login_as(UserRole.admin)
        user = create_user(role=UserRole.viewer)
        response = client.patch(
            f"/api/auth/users/{user.id}", json={"role": "editor"}, headers=admin_headers
        )
        assert response.status_code == 200
        assert response.json()["role"] == "editor"

    def test_role_change_applies_to_live_sessions(self, client: TestClient, login_as, db_session):
        admin_headers, _ = login_as(UserRole.admin)
        viewer_headers, viewer = login_as(UserRole.viewer)

        client.patch(f"/api/auth/users/{viewer.id}", json={"role": "editor"}, headers=admin_headers)
        created = client.post(
            "/api/surveyors", json={"first_name": "A", "last_name": "B"}, headers=viewer_headers
        )
        assert created.status_code == 201

    def test_deactivation_revokes_sessions(self, client: TestClient, login_as):
        admin_headers, _ = login_as(UserRole.admin)
        viewer_headers, viewer = login_as(UserRole.viewer)

        response = client.patch(
            f"/api/auth/users/{viewer.id}", json={"is_active": False}, headers=admin_headers
        )
        assert response.status_code == 200
        assert client.get("/api/surveyors", headers=viewer_headers).status_code == 401

    def test_cannot_demote_or_deactivate_self(self, client: TestClient, login_as):
        admin_headers, admin = login_as(UserRole.admin)
        assert client.patch(
            f"/api/auth/users/{admin.id}", json={"role": "viewer"}, headers=admin_headers
        ).status_code == 400
        assert client.patch(
            f"/api/auth/users/{admin.id}", json={"is_active": False}, headers=admin_headers
        ).status_code == 400


# ============================================================================
# Survey self-signup (Spaces)
# ============================================================================

class TestSurveySignup:
    def test_viewer_signs_up_creates_linked_surveyor(
        self, client: TestClient, login_as, create_survey, db_session
    ):
        headers, user = login_as(UserRole.viewer, first_name="Nell", last_name="Woods")
        survey = create_survey()
        survey.status = "scheduled"
        db_session.add(survey)
        db_session.commit()

        response = client.post(f"/api/surveys/{survey.id}/signup", headers=headers)
        assert response.status_code == 200
        surveyor_id = response.json()["surveyor_id"]

        surveyor = db_session.get(Surveyor, surveyor_id)
        assert surveyor.user_id == user.id
        assert surveyor.first_name == "Nell"
        assert response.json()["surveyor_ids"] == [surveyor_id]

    def test_signup_never_links_existing_surveyor_by_name(
        self, client: TestClient, login_as, create_survey, create_surveyor, db_session
    ):
        """No heuristic matching: even an exact name match gets a NEW
        surveyor. Historical surveyors are merged deliberately by an admin,
        never guessed at — a wrong guess would mis-attribute survey history."""
        existing = create_surveyor(first_name="Nell", last_name="Woods")
        headers, user = login_as(UserRole.viewer, first_name="Nell", last_name="Woods")
        survey = create_survey()
        survey.status = "scheduled"
        db_session.add(survey)
        db_session.commit()

        response = client.post(f"/api/surveys/{survey.id}/signup", headers=headers)
        assert response.status_code == 200
        assert response.json()["surveyor_id"] != existing.id
        db_session.refresh(existing)
        assert existing.user_id is None

        new_surveyor = db_session.get(Surveyor, response.json()["surveyor_id"])
        assert new_surveyor.user_id == user.id

    def test_signup_is_idempotent(self, client: TestClient, login_as, create_survey, db_session):
        headers, _ = login_as(UserRole.viewer)
        survey = create_survey()
        survey.status = "scheduled"
        db_session.add(survey)
        db_session.commit()

        first = client.post(f"/api/surveys/{survey.id}/signup", headers=headers)
        second = client.post(f"/api/surveys/{survey.id}/signup", headers=headers)
        assert first.json()["surveyor_ids"] == second.json()["surveyor_ids"]

    def test_signup_only_on_scheduled_surveys(self, client: TestClient, login_as, create_survey):
        headers, _ = login_as(UserRole.viewer)
        survey = create_survey()  # defaults to completed
        assert client.post(f"/api/surveys/{survey.id}/signup", headers=headers).status_code == 400

    def test_signup_does_not_touch_other_surveyors(
        self, client: TestClient, login_as, create_survey, create_surveyor, db_session
    ):
        other = create_surveyor(first_name="Someone", last_name="Else")
        survey = create_survey(surveyor_ids=[other.id])
        survey.status = "scheduled"
        db_session.add(survey)
        db_session.commit()

        headers, _ = login_as(UserRole.viewer)
        response = client.post(f"/api/surveys/{survey.id}/signup", headers=headers)
        assert other.id in response.json()["surveyor_ids"]
        assert len(response.json()["surveyor_ids"]) == 2

    def test_withdraw(self, client: TestClient, login_as, create_survey, db_session):
        headers, _ = login_as(UserRole.viewer)
        survey = create_survey()
        survey.status = "scheduled"
        db_session.add(survey)
        db_session.commit()

        client.post(f"/api/surveys/{survey.id}/signup", headers=headers)
        response = client.delete(f"/api/surveys/{survey.id}/signup", headers=headers)
        assert response.status_code == 200
        assert response.json()["surveyor_ids"] == []

    def test_admin_can_also_self_signup(
        self, client: TestClient, auth_headers, create_survey, db_session
    ):
        """Self sign-up is an any-role action, admins included."""
        survey = create_survey()
        survey.status = "scheduled"
        db_session.add(survey)
        db_session.commit()
        response = client.post(f"/api/surveys/{survey.id}/signup", headers=auth_headers)
        assert response.status_code == 200
