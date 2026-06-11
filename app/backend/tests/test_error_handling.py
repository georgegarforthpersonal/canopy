"""
Tests for error handling on long-running requests.

Covers the two failure modes found when the audio wizard started timing out
against Neon's connection pooler:
- get_db teardown raising OperationalError after the handler succeeded
- unhandled 500s served without CORS headers, which cross-origin browsers
  surface as an unreadable "Failed to fetch"
"""

from typing import Generator
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from config import settings
from database import connection
from main import app


# ============================================================================
# get_db teardown
# ============================================================================

def _reaped_connection_error() -> OperationalError:
    return OperationalError(
        "ROLLBACK", None, Exception("SSL connection has been closed unexpectedly")
    )


def test_get_db_invalidates_session_when_close_fails(monkeypatch):
    """A connection reaped mid-request must not raise out of teardown."""
    session = Mock()
    session.close.side_effect = _reaped_connection_error()
    monkeypatch.setattr(connection, "get_session_factory", lambda: lambda: session)

    gen = connection.get_db()
    assert next(gen) is session
    gen.close()  # runs the finally block; must not raise

    session.invalidate.assert_called_once()


def test_get_db_closes_session_normally(monkeypatch):
    session = Mock()
    monkeypatch.setattr(connection, "get_session_factory", lambda: lambda: session)

    gen = connection.get_db()
    next(gen)
    gen.close()

    session.close.assert_called_once()
    session.invalidate.assert_not_called()


# ============================================================================
# Unhandled exceptions get CORS headers
# ============================================================================

BOOM_PATH = "/api/_test/boom"


@pytest.fixture
def boom_client() -> Generator[TestClient, None, None]:
    """Client against an app with a route that raises an unhandled error."""

    @app.get(BOOM_PATH)
    async def _boom() -> None:
        raise RuntimeError("boom")

    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client

    app.router.routes = [
        r for r in app.router.routes if getattr(r, "path", None) != BOOM_PATH
    ]


def test_unhandled_error_returns_json_500_with_cors_headers(boom_client):
    origin = settings.allowed_origins[0]
    response = boom_client.get(BOOM_PATH, headers={"Origin": origin})

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"


def test_unhandled_error_omits_cors_headers_for_unknown_origin(boom_client):
    response = boom_client.get(BOOM_PATH, headers={"Origin": "https://evil.example"})

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
    assert "access-control-allow-origin" not in response.headers
