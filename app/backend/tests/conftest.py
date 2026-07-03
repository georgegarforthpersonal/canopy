"""
Pytest Configuration and Shared Fixtures

Provides fixtures for:
- Test database session with cleanup
- FastAPI TestClient with dependency overrides
- Test organisation
- Authentication tokens
"""

import os
import pytest
from typing import Generator
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from sqlmodel import SQLModel

# Set test environment variables before importing app modules
# Tests drive processing explicitly; never run the polling dispatcher
os.environ.setdefault("JOB_DISPATCHER_ENABLED", "false")

from fastapi import Request

from main import app
from database.connection import get_db
from dependencies import get_current_organisation
from auth import (
    create_user_session,
    get_current_principal,
    hash_password,
    login_rate_limiter,
    reset_rate_limiter,
    resolve_principal,
)
from models import (
    Organisation, Surveyor, Location, Species, SpeciesType,
    SurveyType, Survey, SurveySurveyor, Device, DeviceType,
    User, UserRole,
)


# ============================================================================
# Database Fixtures
# ============================================================================

def get_test_database_url() -> str:
    """Build database URL from environment variables."""
    host = os.getenv("DB_HOST", "localhost")
    port = os.getenv("DB_PORT", "5432")
    database = os.getenv("DB_NAME", "test_db")
    user = os.getenv("DB_USER", "postgres")
    password = os.getenv("DB_PASSWORD", "postgres")
    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


@pytest.fixture(scope="session")
def test_engine():
    """Create a test database engine (session-scoped for performance)."""
    engine = create_engine(
        get_test_database_url(),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )
    # Create all tables
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture(scope="function")
def db_session(test_engine) -> Generator[Session, None, None]:
    """
    Provide a database session for each test.

    Uses a transaction that is rolled back after each test for isolation.
    """
    connection = test_engine.connect()
    transaction = connection.begin()

    TestSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=connection,
    )
    session = TestSessionLocal()

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture(autouse=True)
def _reset_rate_limiters():
    """Login limiters are in-memory and would otherwise leak across tests."""
    login_rate_limiter.reset()
    reset_rate_limiter.reset()


# ============================================================================
# Test Organisation Fixture
# ============================================================================

@pytest.fixture
def test_org(db_session: Session) -> Organisation:
    """
    Create a test organisation.

    This organisation is used for all tests and cleaned up after each test
    via transaction rollback.
    """
    org = Organisation(
        name="Test Organisation",
        slug="test-org",
        is_active=True,
    )
    db_session.add(org)
    db_session.commit()
    db_session.refresh(org)
    return org


# ============================================================================
# Authentication Fixtures
# ============================================================================

@pytest.fixture
def auth_headers(db_session: Session, create_user) -> dict:
    """Session headers for an admin user.

    Most endpoint tests just need "an authenticated caller that passes every
    role check", which is what the old shared-password token provided; an
    admin account is its modern equivalent.
    """
    admin = create_user(
        email="fixture-admin@example.org",
        role=UserRole.admin,
        first_name="Fixture",
        last_name="Admin",
    )
    token = create_user_session(db_session, admin)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def create_user(db_session: Session, test_org: Organisation):
    """Factory fixture to create user accounts."""
    _counter = {"n": 0}

    def _create_user(
        email: str = None,
        role: UserRole = UserRole.viewer,
        password: str = "correct-horse-battery",
        first_name: str = "Test",
        last_name: str = "User",
        is_active: bool = True,
    ) -> User:
        if email is None:
            _counter["n"] += 1
            email = f"{role.value}{_counter['n']}@example.org"
        user = User(
            organisation_id=test_org.id,
            email=email.lower(),
            first_name=first_name,
            last_name=last_name,
            password_hash=hash_password(password),
            role=role,
            is_active=is_active,
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        return user

    return _create_user


@pytest.fixture
def login_as(db_session: Session, create_user):
    """Factory fixture: create a user with a role and return (headers, user)."""

    def _login_as(role: UserRole = UserRole.viewer, **kwargs):
        user = create_user(role=role, **kwargs)
        token = create_user_session(db_session, user)
        return {"Authorization": f"Bearer {token}"}, user

    return _login_as


# ============================================================================
# FastAPI TestClient Fixture
# ============================================================================

@pytest.fixture
def client(db_session: Session, test_org: Organisation) -> Generator[TestClient, None, None]:
    """
    Create a FastAPI TestClient with dependency overrides.

    Overrides:
    - get_db: Use test database session
    - get_current_organisation: Return test organisation
    """

    def override_get_db():
        try:
            yield db_session
        finally:
            pass  # Session cleanup handled by db_session fixture

    async def override_get_current_organisation():
        return test_org

    def override_get_current_principal(request: Request):
        # Same resolution logic as production, but against the test
        # transaction (production opens its own DB session, which cannot
        # see uncommitted test data).
        return resolve_principal(request, db_session)

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_organisation] = override_get_current_organisation
    app.dependency_overrides[get_current_principal] = override_get_current_principal

    with TestClient(app) as test_client:
        yield test_client

    # Clear overrides after test
    app.dependency_overrides.clear()


# ============================================================================
# Helper Fixtures
# ============================================================================

@pytest.fixture
def create_surveyor(db_session: Session, test_org: Organisation):
    """Factory fixture to create surveyors."""
    def _create_surveyor(
        first_name: str = "Test",
        last_name: str = "Surveyor",
        is_active: bool = True,
    ) -> Surveyor:
        surveyor = Surveyor(
            first_name=first_name,
            last_name=last_name,
            organisation_id=test_org.id,
            is_active=is_active,
        )
        db_session.add(surveyor)
        db_session.commit()
        db_session.refresh(surveyor)
        return surveyor

    return _create_surveyor


@pytest.fixture
def create_location(db_session: Session, test_org: Organisation):
    """Factory fixture to create locations."""
    def _create_location(name: str = "Test Location") -> Location:
        location = Location(
            name=name,
            organisation_id=test_org.id,
        )
        db_session.add(location)
        db_session.commit()
        db_session.refresh(location)
        return location

    return _create_location


@pytest.fixture
def create_species(db_session: Session, create_species_type):
    """Factory fixture to create species (global, not org-specific)."""
    # Cache species_type_ids to avoid creating duplicates
    _species_type_cache: dict[str, int] = {}

    def _create_species(
        name: str = "Test Species",
        scientific_name: str = "Testus specius",
        species_type: str = "butterfly",
    ) -> Species:
        # Get or create the species_type record
        if species_type not in _species_type_cache:
            existing = db_session.query(SpeciesType).filter(SpeciesType.name == species_type).first()
            if existing:
                _species_type_cache[species_type] = existing.id  # type: ignore[assignment]
            else:
                st = create_species_type(name=species_type, display_name=species_type.title())
                _species_type_cache[species_type] = st.id  # type: ignore[assignment]

        species = Species(
            name=name,
            scientific_name=scientific_name,
            species_type_id=_species_type_cache[species_type],
        )
        db_session.add(species)
        db_session.commit()
        db_session.refresh(species)
        return species

    return _create_species


@pytest.fixture
def create_species_type(db_session: Session):
    """Factory fixture to create species types (global reference data)."""
    def _create_species_type(
        name: str = "butterfly",
        display_name: str = "Butterfly",
    ) -> SpeciesType:
        species_type = SpeciesType(
            name=name,
            display_name=display_name,
        )
        db_session.add(species_type)
        db_session.commit()
        db_session.refresh(species_type)
        return species_type

    return _create_species_type


@pytest.fixture
def create_survey_type(db_session: Session, test_org: Organisation):
    """Factory fixture to create survey types."""
    def _create_survey_type(
        name: str = "Test Survey Type",
        is_active: bool = True,
        schedule_cadence: str = "date",
    ) -> SurveyType:
        survey_type = SurveyType(
            name=name,
            organisation_id=test_org.id,
            is_active=is_active,
            schedule_cadence=schedule_cadence,
        )
        db_session.add(survey_type)
        db_session.commit()
        db_session.refresh(survey_type)
        return survey_type

    return _create_survey_type


@pytest.fixture
def create_survey(db_session: Session, test_org: Organisation):
    """Factory fixture to create surveys."""
    from datetime import date

    def _create_survey(
        survey_date: date = None,
        location_id: int = None,
        survey_type_id: int = None,
        surveyor_ids: list = None,
    ) -> Survey:
        survey = Survey(
            date=survey_date or date.today(),
            organisation_id=test_org.id,
            location_id=location_id,
            survey_type_id=survey_type_id,
        )
        db_session.add(survey)
        db_session.commit()
        db_session.refresh(survey)

        # Add surveyor associations if provided
        if surveyor_ids:
            for surveyor_id in surveyor_ids:
                link = SurveySurveyor(survey_id=survey.id, surveyor_id=surveyor_id)
                db_session.add(link)
            db_session.commit()

        return survey

    return _create_survey


@pytest.fixture
def create_device(db_session: Session, test_org: Organisation):
    """Factory fixture to create devices."""
    def _create_device(
        device_id: str = "TEST001",
        name: str = "Test Device",
        device_type: DeviceType = DeviceType.audio_recorder,
        is_active: bool = True,
        latitude: float = 51.5,
        longitude: float = -0.12,
    ) -> Device:
        device = Device(
            device_id=device_id,
            name=name,
            device_type=device_type,
            organisation_id=test_org.id,
            is_active=is_active,
            point_geometry=f"SRID=4326;POINT({longitude} {latitude})",
        )
        db_session.add(device)
        db_session.commit()
        db_session.refresh(device)
        return device

    return _create_device
