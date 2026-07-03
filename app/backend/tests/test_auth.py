"""
Tests for Auth Router basics: login, logout, status.

The full account system (roles, invites, resets, user management) is
covered in test_accounts.py.
"""

from fastapi.testclient import TestClient


class TestLogin:
    """Tests for POST /api/auth/login"""

    def test_login_success(self, client: TestClient, create_user):
        """Should return token on successful login."""
        create_user(email="jane@example.org", password="a-strong-password")
        response = client.post(
            "/api/auth/login",
            json={"email": "jane@example.org", "password": "a-strong-password"},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["authenticated"] is True
        assert "token" in data

    def test_login_wrong_password(self, client: TestClient, create_user):
        """Should return 401 for wrong password."""
        create_user(email="jane@example.org", password="a-strong-password")
        response = client.post(
            "/api/auth/login",
            json={"email": "jane@example.org", "password": "wrong-password"},
        )
        assert response.status_code == 401
        assert "incorrect" in response.json()["detail"].lower()

    def test_login_requires_email(self, client: TestClient, test_org):
        """The legacy password-only body is gone: email is required."""
        response = client.post(
            "/api/auth/login",
            json={"password": "anything"},
        )
        assert response.status_code == 422


class TestLogout:
    """Tests for POST /api/auth/logout"""

    def test_logout(self, client: TestClient, test_org):
        """Should return authenticated=false on logout."""
        response = client.post("/api/auth/logout")
        assert response.status_code == 200
        assert response.json()["authenticated"] is False


class TestAuthStatus:
    """Tests for GET /api/auth/status"""

    def test_status_authenticated(
        self, client: TestClient, auth_headers: dict, test_org
    ):
        """Should return authenticated=true with valid session."""
        response = client.get("/api/auth/status", headers=auth_headers)
        assert response.status_code == 200

        data = response.json()
        assert data["authenticated"] is True
        assert data["organisation"]["slug"] == test_org.slug

    def test_status_unauthenticated(self, client: TestClient, test_org):
        """Should return authenticated=false without a session."""
        response = client.get("/api/auth/status")
        assert response.status_code == 200
        assert response.json()["authenticated"] is False

    def test_status_invalid_token(self, client: TestClient, test_org):
        """Should return authenticated=false with an invalid token."""
        response = client.get(
            "/api/auth/status",
            headers={"Authorization": "Bearer invalid-token"},
        )
        assert response.status_code == 200
        assert response.json()["authenticated"] is False
