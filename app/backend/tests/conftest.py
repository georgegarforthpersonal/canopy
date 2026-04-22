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
os.environ.setdefault("SESSION_SECRET_KEY", "test-secret-key")

from main import app
from database.connection import get_db
from dependencies import get_current_organisation
from auth import create_session_token
from models import (
    Organisation, Surveyor, Location, Species, SpeciesType,
    SurveyType, Survey, SurveySurveyor, Device, DeviceType
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
        admin_password="test-password",
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
def auth_token(test_org: Organisation) -> str:
    """Generate a valid session token for the test organisation."""
    return create_session_token(test_org.slug)


@pytest.fixture
def auth_headers(auth_token: str) -> dict:
    """Return headers with Authorization bearer token."""
    return {"Authorization": f"Bearer {auth_token}"}


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

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_organisation] = override_get_current_organisation

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
    ) -> SurveyType:
        survey_type = SurveyType(
            name=name,
            organisation_id=test_org.id,
            is_active=is_active,
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
