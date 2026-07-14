"""
Tests for user accounts: login, roles, invites, password reset,
user management and survey self-signup.
"""

from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from models import Invite, Organisation, Surveyor, SurveySurveyor, User, UserRole


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
    def _invite(self, client, headers, email="new@example.org", role="viewer", surveyor_id=None):
        response = client.post(
            "/api/auth/invites",
            json={"email": email, "role": role, "surveyor_id": surveyor_id},
            headers=headers,
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

    def test_lookup_of_used_invite_says_so(self, client: TestClient, login_as):
        """Re-clicking the invite email after signing up is the most common
        dead end — the lookup distinguishes it (410) so the page can point
        at sign-in instead of claiming the link is broken."""
        admin_headers, _ = login_as(UserRole.admin)
        token = _token_from_url(self._invite(client, admin_headers)["invite_url"])
        assert client.post(
            "/api/auth/accept-invite",
            json={"token": token, "first_name": "New", "password": "a-strong-password"},
        ).status_code == 200

        response = client.get(f"/api/auth/invites/lookup?token={token}")
        assert response.status_code == 410
        assert "already been used" in response.json()["detail"]

    def test_reinviting_replaces_open_invite(self, client: TestClient, login_as):
        admin_headers, _ = login_as(UserRole.admin)
        first_token = _token_from_url(self._invite(client, admin_headers)["invite_url"])
        second_token = _token_from_url(self._invite(client, admin_headers)["invite_url"])

        assert client.get(f"/api/auth/invites/lookup?token={first_token}").status_code == 404
        assert client.get(f"/api/auth/invites/lookup?token={second_token}").status_code == 200

    def test_resend_without_email_returns_link_only(self, client: TestClient, login_as, monkeypatch):
        """The copy-link button regenerates the link without emailing anyone."""
        import routers.auth as auth_router

        sent: list = []
        monkeypatch.setattr(auth_router, "send_invite_email", lambda *a, **k: sent.append(a) or True)

        admin_headers, _ = login_as(UserRole.admin)
        invite_id = self._invite(client, admin_headers)["invite"]["id"]
        sent.clear()

        response = client.post(
            f"/api/auth/invites/{invite_id}/resend?send_email=false", headers=admin_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["email_sent"] is False
        assert sent == []
        # The returned link is live
        token = _token_from_url(data["invite_url"])
        assert client.get(f"/api/auth/invites/lookup?token={token}").status_code == 200

    def test_resend_with_email_still_sends(self, client: TestClient, login_as, monkeypatch):
        import routers.auth as auth_router

        sent: list = []
        monkeypatch.setattr(auth_router, "send_invite_email", lambda *a, **k: sent.append(a) or True)

        admin_headers, _ = login_as(UserRole.admin)
        invite_id = self._invite(client, admin_headers)["invite"]["id"]
        sent.clear()

        response = client.post(f"/api/auth/invites/{invite_id}/resend", headers=admin_headers)
        assert response.status_code == 200
        assert response.json()["email_sent"] is True
        assert len(sent) == 1


# ============================================================================
# Invite-time surveyor linking
# ============================================================================

class TestInviteSurveyorLinking:
    _invite = TestInvites._invite

    def _accept(self, client, invite_url, first_name="Nell", last_name="Woods"):
        response = client.post(
            "/api/auth/accept-invite",
            json={
                "token": _token_from_url(invite_url),
                "first_name": first_name,
                "last_name": last_name,
                "password": "a-strong-password",
            },
        )
        assert response.status_code == 200, response.text
        return response.json()

    def test_plain_accept_creates_fresh_linked_surveyor(
        self, client: TestClient, login_as, db_session
    ):
        """The surveyor exists as soon as the account does — no survey
        signup needed."""
        admin_headers, _ = login_as(UserRole.admin)
        invited = self._invite(client, admin_headers)
        accepted = self._accept(client, invited["invite_url"])

        surveyor = db_session.query(Surveyor).filter(
            Surveyor.user_id == accepted["user"]["id"]
        ).one()
        assert surveyor.first_name == "Nell"
        assert surveyor.last_name == "Woods"

    def test_accept_claims_linked_surveyor(
        self, client: TestClient, login_as, create_surveyor, db_session
    ):
        admin_headers, _ = login_as(UserRole.admin)
        existing = create_surveyor(first_name="Bernie", last_name="Garforth", is_active=False)
        invited = self._invite(client, admin_headers, surveyor_id=existing.id)

        # Registrant types a different name; the surveyor row keeps the
        # historical one (it labels past surveys), the account keeps theirs.
        accepted = self._accept(client, invited["invite_url"], first_name="Bernard")

        db_session.refresh(existing)
        assert existing.user_id == accepted["user"]["id"]
        assert existing.is_active is True  # claiming reactivates
        assert existing.first_name == "Bernie"
        linked = db_session.query(Surveyor).filter(
            Surveyor.user_id == accepted["user"]["id"]
        ).all()
        assert [s.id for s in linked] == [existing.id]  # no duplicate created

    def test_accept_falls_back_when_surveyor_claimed_meanwhile(
        self, client: TestClient, login_as, create_surveyor, create_user, db_session
    ):
        """A stale invite must not fail registration or steal the row."""
        admin_headers, _ = login_as(UserRole.admin)
        existing = create_surveyor(first_name="Bernie", last_name="Garforth")
        invited = self._invite(client, admin_headers, surveyor_id=existing.id)

        other = create_user(email="other@example.org")
        existing.user_id = other.id
        db_session.add(existing)
        db_session.commit()

        accepted = self._accept(client, invited["invite_url"])
        db_session.refresh(existing)
        assert existing.user_id == other.id  # untouched
        fresh = db_session.query(Surveyor).filter(
            Surveyor.user_id == accepted["user"]["id"]
        ).one()
        assert fresh.id != existing.id

    def test_invite_rejects_unknown_surveyor(self, client: TestClient, login_as):
        admin_headers, _ = login_as(UserRole.admin)
        response = client.post(
            "/api/auth/invites",
            json={"email": "new@example.org", "role": "viewer", "surveyor_id": 99999},
            headers=admin_headers,
        )
        assert response.status_code == 404

    def test_invite_rejects_other_orgs_surveyor(
        self, client: TestClient, login_as, db_session
    ):
        admin_headers, _ = login_as(UserRole.admin)
        other_org = Organisation(name="Other", slug="other")
        db_session.add(other_org)
        db_session.commit()
        foreign = Surveyor(first_name="Far", last_name="Away", organisation_id=other_org.id)
        db_session.add(foreign)
        db_session.commit()

        response = client.post(
            "/api/auth/invites",
            json={"email": "new@example.org", "role": "viewer", "surveyor_id": foreign.id},
            headers=admin_headers,
        )
        assert response.status_code == 404

    def test_invite_rejects_already_linked_surveyor(
        self, client: TestClient, login_as, create_surveyor, create_user
    ):
        admin_headers, _ = login_as(UserRole.admin)
        user = create_user(email="linked@example.org")
        linked = create_surveyor(first_name="Al", last_name="Ready", user_id=user.id)
        response = client.post(
            "/api/auth/invites",
            json={"email": "new@example.org", "role": "viewer", "surveyor_id": linked.id},
            headers=admin_headers,
        )
        assert response.status_code == 409

    def test_invite_rejects_surveyor_on_another_open_invite(
        self, client: TestClient, login_as, create_surveyor
    ):
        admin_headers, _ = login_as(UserRole.admin)
        surveyor = create_surveyor(first_name="Bernie", last_name="Garforth")
        self._invite(client, admin_headers, email="first@example.org", surveyor_id=surveyor.id)

        response = client.post(
            "/api/auth/invites",
            json={"email": "second@example.org", "role": "viewer", "surveyor_id": surveyor.id},
            headers=admin_headers,
        )
        assert response.status_code == 409
        # Re-inviting the SAME email with the same surveyor replaces the
        # open invite, as for plain invites.
        self._invite(client, admin_headers, email="first@example.org", surveyor_id=surveyor.id)

    def test_expired_invite_does_not_block_relinking(
        self, client: TestClient, login_as, create_surveyor, db_session
    ):
        """Expired invites are inert everywhere else; they must not hold a
        surveyor hostage either."""
        admin_headers, _ = login_as(UserRole.admin)
        surveyor = create_surveyor(first_name="Bernie", last_name="Garforth")
        self._invite(client, admin_headers, email="old-address@example.org", surveyor_id=surveyor.id)
        invite = db_session.query(Invite).order_by(Invite.id.desc()).first()
        invite.expires_at = datetime.utcnow() - timedelta(hours=1)
        db_session.add(invite)
        db_session.commit()

        # 201, not 409 — the dead invite can never claim the surveyor
        self._invite(client, admin_headers, email="right-address@example.org", surveyor_id=surveyor.id)

    def test_lookup_shows_surveyor_until_claimed(
        self, client: TestClient, login_as, create_surveyor, create_user, db_session
    ):
        admin_headers, _ = login_as(UserRole.admin)
        surveyor = create_surveyor(first_name="Bernie", last_name="Garforth")
        token = _token_from_url(
            self._invite(client, admin_headers, surveyor_id=surveyor.id)["invite_url"]
        )

        looked_up = client.get(f"/api/auth/invites/lookup?token={token}")
        assert looked_up.json()["surveyor"] == {
            "id": surveyor.id, "first_name": "Bernie", "last_name": "Garforth",
        }

        other = create_user(email="other@example.org")
        surveyor.user_id = other.id
        db_session.add(surveyor)
        db_session.commit()
        assert client.get(f"/api/auth/invites/lookup?token={token}").json()["surveyor"] is None

    def test_list_invites_exposes_surveyor(
        self, client: TestClient, login_as, create_surveyor, create_user, db_session
    ):
        admin_headers, _ = login_as(UserRole.admin)
        surveyor = create_surveyor(first_name="Bernie", last_name="Garforth")
        self._invite(client, admin_headers, surveyor_id=surveyor.id)

        rows = client.get("/api/auth/invites", headers=admin_headers).json()
        assert rows[0]["surveyor_id"] == surveyor.id
        assert rows[0]["surveyor_name"] == "Bernie Garforth"

        # Once the surveyor is claimed elsewhere, the list stops promising a
        # link that acceptance would no longer honour.
        other = create_user(email="other@example.org")
        surveyor.user_id = other.id
        db_session.add(surveyor)
        db_session.commit()
        rows = client.get("/api/auth/invites", headers=admin_headers).json()
        assert rows[0]["surveyor_name"] is None

    def test_link_surveyor_to_pending_invite(
        self, client: TestClient, login_as, create_surveyor, db_session
    ):
        """A plain invite can gain a surveyor link any time before
        acceptance — and acceptance then claims it."""
        admin_headers, _ = login_as(UserRole.admin)
        invited = self._invite(client, admin_headers)
        assert invited["invite"]["surveyor_id"] is None
        surveyor = create_surveyor(first_name="Bernie", last_name="Garforth")

        patched = client.patch(
            f"/api/auth/invites/{invited['invite']['id']}",
            json={"surveyor_id": surveyor.id},
            headers=admin_headers,
        )
        assert patched.status_code == 200
        assert patched.json()["surveyor_name"] == "Bernie Garforth"

        accepted = self._accept(client, invited["invite_url"])
        db_session.refresh(surveyor)
        assert surveyor.user_id == accepted["user"]["id"]

    def test_unlink_surveyor_from_pending_invite(
        self, client: TestClient, login_as, create_surveyor
    ):
        admin_headers, _ = login_as(UserRole.admin)
        surveyor = create_surveyor(first_name="Bernie", last_name="Garforth")
        invited = self._invite(client, admin_headers, surveyor_id=surveyor.id)

        patched = client.patch(
            f"/api/auth/invites/{invited['invite']['id']}",
            json={"surveyor_id": None},
            headers=admin_headers,
        )
        assert patched.status_code == 200
        assert patched.json()["surveyor_id"] is None

    def test_update_invite_keeps_own_surveyor_and_validates_clashes(
        self, client: TestClient, login_as, create_surveyor, create_user
    ):
        admin_headers, _ = login_as(UserRole.admin)
        surveyor = create_surveyor(first_name="Bernie", last_name="Garforth")
        invited = self._invite(client, admin_headers, surveyor_id=surveyor.id)
        invite_id = invited["invite"]["id"]

        # Re-linking its own surveyor is a no-op, not a clash with itself
        assert client.patch(
            f"/api/auth/invites/{invite_id}",
            json={"surveyor_id": surveyor.id},
            headers=admin_headers,
        ).status_code == 200

        # Another live invite's surveyor still clashes
        other_surveyor = create_surveyor(first_name="Someone", last_name="Else")
        self._invite(client, admin_headers, email="second@example.org", surveyor_id=other_surveyor.id)
        assert client.patch(
            f"/api/auth/invites/{invite_id}",
            json={"surveyor_id": other_surveyor.id},
            headers=admin_headers,
        ).status_code == 409

        # A claimed surveyor is rejected
        user = create_user(email="claimed@example.org")
        claimed = create_surveyor(first_name="Al", last_name="Ready", user_id=user.id)
        assert client.patch(
            f"/api/auth/invites/{invite_id}",
            json={"surveyor_id": claimed.id},
            headers=admin_headers,
        ).status_code == 409

    def test_update_invite_rejects_accepted_or_unknown(
        self, client: TestClient, login_as, create_surveyor
    ):
        admin_headers, _ = login_as(UserRole.admin)
        surveyor = create_surveyor(first_name="Bernie", last_name="Garforth")
        invited = self._invite(client, admin_headers)
        self._accept(client, invited["invite_url"])

        # Accepted invites can no longer be edited; unknown ids 404 too
        assert client.patch(
            f"/api/auth/invites/{invited['invite']['id']}",
            json={"surveyor_id": surveyor.id},
            headers=admin_headers,
        ).status_code == 404
        assert client.patch(
            "/api/auth/invites/99999",
            json={"surveyor_id": surveyor.id},
            headers=admin_headers,
        ).status_code == 404

    def test_link_surveyor_to_existing_user(
        self, client: TestClient, login_as, create_user, create_surveyor, db_session
    ):
        """Accounts that predate registration-time surveyor creation can be
        linked directly."""
        admin_headers, _ = login_as(UserRole.admin)
        user = create_user(email="bernie@example.org")
        surveyor = create_surveyor(first_name="Bernie", last_name="Garforth", is_active=False)

        response = client.post(
            f"/api/auth/users/{user.id}/link-surveyor",
            json={"surveyor_id": surveyor.id},
            headers=admin_headers,
        )
        assert response.status_code == 200
        assert response.json()["surveyor_name"] == "Bernie Garforth"
        db_session.refresh(surveyor)
        assert surveyor.user_id == user.id
        assert surveyor.is_active is True

    def test_link_user_replaces_empty_auto_surveyor(
        self, client: TestClient, login_as, create_user, create_surveyor, db_session
    ):
        """A fresh, surveyless auto-created row gives way to the historical
        one instead of blocking the link."""
        admin_headers, _ = login_as(UserRole.admin)
        user = create_user(email="bernie@example.org")
        auto = create_surveyor(first_name="Bernie", last_name="Garforth", user_id=user.id)
        historical = create_surveyor(first_name="Bernie", last_name="Garforth")

        response = client.post(
            f"/api/auth/users/{user.id}/link-surveyor",
            json={"surveyor_id": historical.id},
            headers=admin_headers,
        )
        assert response.status_code == 200
        db_session.expire_all()
        assert db_session.get(Surveyor, auto.id) is None
        db_session.refresh(historical)
        assert historical.user_id == user.id

    def test_link_user_refuses_when_current_surveyor_has_history(
        self, client: TestClient, login_as, create_user, create_surveyor,
        create_survey, db_session
    ):
        admin_headers, _ = login_as(UserRole.admin)
        user = create_user(email="bernie@example.org")
        current = create_surveyor(first_name="Bernie", last_name="Garforth", user_id=user.id)
        survey = create_survey()
        db_session.add(SurveySurveyor(survey_id=survey.id, surveyor_id=current.id))
        db_session.commit()
        historical = create_surveyor(first_name="Bernie", last_name="Garforth")

        response = client.post(
            f"/api/auth/users/{user.id}/link-surveyor",
            json={"surveyor_id": historical.id},
            headers=admin_headers,
        )
        assert response.status_code == 409
        assert "merge" in response.json()["detail"]

    def test_link_user_rejects_claimed_or_invite_held_surveyor(
        self, client: TestClient, login_as, create_user, create_surveyor
    ):
        admin_headers, _ = login_as(UserRole.admin)
        user = create_user(email="bernie@example.org")

        other = create_user(email="other@example.org")
        claimed = create_surveyor(first_name="Al", last_name="Ready", user_id=other.id)
        assert client.post(
            f"/api/auth/users/{user.id}/link-surveyor",
            json={"surveyor_id": claimed.id},
            headers=admin_headers,
        ).status_code == 409

        held = create_surveyor(first_name="Held", last_name="ByInvite")
        self._invite(client, admin_headers, email="invitee@example.org", surveyor_id=held.id)
        assert client.post(
            f"/api/auth/users/{user.id}/link-surveyor",
            json={"surveyor_id": held.id},
            headers=admin_headers,
        ).status_code == 409

    def test_survey_signup_reuses_registration_surveyor(
        self, client: TestClient, login_as, create_surveyor, create_survey, db_session
    ):
        admin_headers, _ = login_as(UserRole.admin)
        existing = create_surveyor(first_name="Bernie", last_name="Garforth")
        invited = self._invite(client, admin_headers, surveyor_id=existing.id)
        accepted = self._accept(client, invited["invite_url"])

        survey = create_survey()
        survey.status = "scheduled"
        db_session.add(survey)
        db_session.commit()

        headers = {"Authorization": f"Bearer {accepted['token']}"}
        response = client.post(f"/api/surveys/{survey.id}/signup", headers=headers)
        assert response.status_code == 200
        assert response.json()["surveyor_id"] == existing.id


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

class TestOrgDomainSessionGuard:
    """Every org's frontend shares one API domain, so the session cookie
    leaks across {org} subdomains. A session must only count on its own
    org's site (X-Org-Slug, derived from the hostname)."""

    def test_session_ignored_on_another_orgs_site(
        self, client: TestClient, auth_headers: dict, db_session, test_org
    ):
        other = Organisation(name="Other Org", slug="other-org", is_active=True)
        db_session.add(other)
        db_session.commit()

        headers = {**auth_headers, "X-Org-Slug": "other-org"}
        me = client.get("/api/auth/me", headers=headers)
        assert me.status_code == 200
        assert me.json()["authenticated"] is False

        # Data reads are anonymous there too — not silently cross-org.
        assert client.get("/api/surveys", headers=headers).status_code == 401

    def test_session_valid_on_own_orgs_site(
        self, client: TestClient, auth_headers: dict, test_org
    ):
        headers = {**auth_headers, "X-Org-Slug": test_org.slug}
        me = client.get("/api/auth/me", headers=headers)
        assert me.json()["authenticated"] is True

    def test_session_valid_without_header(
        self, client: TestClient, auth_headers: dict, test_org
    ):
        """curl/scripts don't send X-Org-Slug; the session still works."""
        me = client.get("/api/auth/me", headers=auth_headers)
        assert me.json()["authenticated"] is True


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
