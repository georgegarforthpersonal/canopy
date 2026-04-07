"""
SQLModel Database Models

Unified models using SQLModel (SQLAlchemy + Pydantic) for both:
- Database ORM operations
- FastAPI request/response validation

Replaces:
- app/database/models.py (dataclasses)
- schemas/models.py (Pydantic schemas)
"""

from datetime import date as date_type, time as time_type, datetime
from typing import Optional, List
from decimal import Decimal
from enum import Enum as PyEnum
from sqlmodel import Field, SQLModel, Relationship
import sqlalchemy as sa


# ============================================================================
# Device Type Enum
# ============================================================================

class DeviceType(str, PyEnum):
    """Type of recording device"""
    audio_recorder = "audio_recorder"
    camera_trap = "camera_trap"


# ============================================================================
# Organisation Models
# ============================================================================

class OrganisationBase(SQLModel):
    """Base organisation fields"""
    name: str = Field(max_length=255, description="Organisation name")
    slug: str = Field(max_length=100, description="URL-friendly identifier")


class Organisation(OrganisationBase, table=True):  # type: ignore[call-arg]
    """Organisation database model"""
    __tablename__ = "organisation"

    id: Optional[int] = Field(default=None, primary_key=True)
    admin_password: str = Field(max_length=255, description="Admin password for this organisation")
    is_active: bool = Field(default=True, description="Whether organisation is active")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Relationships
    surveys: List["Survey"] = Relationship(back_populates="organisation")
    surveyors: List["Surveyor"] = Relationship(back_populates="organisation")
    locations: List["Location"] = Relationship(back_populates="organisation")
    survey_types: List["SurveyType"] = Relationship(back_populates="organisation")
    devices: List["Device"] = Relationship(back_populates="organisation")


class OrganisationRead(OrganisationBase):
    """Model for reading organisation (public info, no password hash)"""
    id: int
    is_active: bool


# ============================================================================
# Device Models (Audio Recorder Devices)
# ============================================================================

class DeviceBase(SQLModel):
    """Base device fields"""
    device_id: str = Field(max_length=50, description="Device serial number from audio filenames")
    name: Optional[str] = Field(None, max_length=255, description="Friendly name for the device")
    device_type: DeviceType = Field(default=DeviceType.audio_recorder, description="Type of device")


class Device(DeviceBase, table=True):  # type: ignore[call-arg]
    """Device database model for audio recording devices"""
    __tablename__ = "device"
    __table_args__ = (
        sa.UniqueConstraint('organisation_id', 'device_id', name='uq_device_org_device_id'),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    organisation_id: int = Field(foreign_key="organisation.id", index=True, description="Organisation this device belongs to")
    location_id: Optional[int] = Field(None, foreign_key="location.id", description="Associated location area")
    is_active: bool = Field(default=True, description="Whether device is active")

    # PostGIS Point geometry (stored as text, cast in queries)
    point_geometry: Optional[str] = Field(
        default=None,
        sa_column=sa.Column(
            "point_geometry",
            sa.Text,  # PostGIS geometry stored as text, cast in queries
            nullable=True
        )
    )

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Relationships
    organisation: Optional["Organisation"] = Relationship(back_populates="devices")
    location: Optional["Location"] = Relationship(back_populates="devices")


class DeviceCreate(DeviceBase):
    """Model for creating a new device"""
    latitude: Optional[float] = Field(None, ge=-90, le=90, description="Latitude coordinate")
    longitude: Optional[float] = Field(None, ge=-180, le=180, description="Longitude coordinate")
    location_id: Optional[int] = Field(None, description="Associated location ID")


class DeviceUpdate(SQLModel):
    """Model for updating a device (all fields optional)"""
    device_id: Optional[str] = Field(None, max_length=50)
    name: Optional[str] = Field(None, max_length=255)
    device_type: Optional[DeviceType] = None
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    location_id: Optional[int] = None
    is_active: Optional[bool] = None


class DeviceRead(DeviceBase):
    """Model for reading a device"""
    id: int
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_id: Optional[int] = None
    location_name: Optional[str] = None
    is_active: bool


# ============================================================================
# Junction Tables
# ============================================================================

class SurveySurveyor(SQLModel, table=True):  # type: ignore[call-arg]
    """Junction table linking surveys to surveyors (many-to-many)"""
    __tablename__ = "survey_surveyor"

    id: Optional[int] = Field(default=None, primary_key=True)
    survey_id: int = Field(foreign_key="survey.id", ondelete="CASCADE")
    surveyor_id: int = Field(foreign_key="surveyor.id", ondelete="CASCADE")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )


class SurveyTypeLocationLink(SQLModel, table=True):  # type: ignore[call-arg]
    """Junction table linking survey types to locations"""
    __tablename__ = "survey_type_location"

    id: Optional[int] = Field(default=None, primary_key=True)
    survey_type_id: int = Field(foreign_key="survey_type.id", ondelete="CASCADE")
    location_id: int = Field(foreign_key="location.id", ondelete="CASCADE")


class SurveyTypeSpeciesTypeLink(SQLModel, table=True):  # type: ignore[call-arg]
    """Junction table linking survey types to species types"""
    __tablename__ = "survey_type_species_type"

    id: Optional[int] = Field(default=None, primary_key=True)
    survey_type_id: int = Field(foreign_key="survey_type.id", ondelete="CASCADE")
    species_type_id: int = Field(foreign_key="species_type.id", ondelete="CASCADE")


# ============================================================================
# Surveyor Models
# ============================================================================

class SurveyorBase(SQLModel):
    """Base surveyor fields - shared between Create and Read"""
    first_name: str = Field(max_length=255, description="Surveyor's first name")
    last_name: Optional[str] = Field(default=None, max_length=255, description="Surveyor's last name (optional)")


class Surveyor(SurveyorBase, table=True):  # type: ignore[call-arg]
    """Surveyor database model"""
    __tablename__ = "surveyor"

    id: Optional[int] = Field(default=None, primary_key=True)
    organisation_id: int = Field(foreign_key="organisation.id", index=True, description="Organisation this surveyor belongs to")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )
    is_active: bool = Field(default=True, description="Whether surveyor is active")

    # Relationships
    organisation: Optional["Organisation"] = Relationship(back_populates="surveyors")
    surveys: List["Survey"] = Relationship(back_populates="surveyors", link_model=SurveySurveyor)


class SurveyorCreate(SurveyorBase):
    """Model for creating a new surveyor"""
    pass


class SurveyorUpdate(SQLModel):
    """Model for updating a surveyor (all fields optional)"""
    first_name: Optional[str] = Field(None, max_length=255)
    last_name: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None


class SurveyorRead(SurveyorBase):
    """Model for reading a surveyor (includes ID)"""
    id: int
    is_active: bool


# ============================================================================
# Species Models
# ============================================================================

class SpeciesBase(SQLModel):
    """Base species fields"""
    name: Optional[str] = Field(None, max_length=255, description="Species common name")
    conservation_status: Optional[str] = Field(None, max_length=50, description="Conservation status")
    species_type_id: int = Field(foreign_key="species_type.id", description="FK to species_type reference table")
    scientific_name: Optional[str] = Field(None, max_length=255, description="Scientific/Latin name from NBN Atlas")
    nbn_atlas_guid: Optional[str] = Field(None, max_length=255, description="NBN Atlas GUID for reference")
    species_code: Optional[str] = Field(None, max_length=10, description="Short code for map display (e.g., BTO 2-letter codes for birds)")


class Species(SpeciesBase, table=True):  # type: ignore[call-arg]
    """Species database model"""
    __tablename__ = "species"
    __table_args__ = (
        sa.Index('ix_species_scientific_name', 'scientific_name'),
        sa.Index('ix_species_nbn_atlas_guid', 'nbn_atlas_guid'),
        sa.Index('ix_species_species_type_id', 'species_type_id'),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Relationships
    sightings: List["Sighting"] = Relationship(back_populates="species")
    species_type: Optional["SpeciesType"] = Relationship()


class SpeciesCreate(SQLModel):
    """Model for creating a new species"""
    name: Optional[str] = Field(None, max_length=255)
    conservation_status: Optional[str] = Field(None, max_length=50)
    species_type_id: int = Field(description="FK to species_type reference table")
    scientific_name: Optional[str] = Field(None, max_length=255)
    nbn_atlas_guid: Optional[str] = Field(None, max_length=255)
    species_code: Optional[str] = Field(None, max_length=10)


class SpeciesUpdate(SQLModel):
    """Model for updating a species (all fields optional)"""
    name: Optional[str] = Field(None, max_length=255)
    conservation_status: Optional[str] = Field(None, max_length=50)
    species_type_id: Optional[int] = Field(None, description="FK to species_type reference table")
    scientific_name: Optional[str] = Field(None, max_length=255)
    nbn_atlas_guid: Optional[str] = Field(None, max_length=255)
    species_code: Optional[str] = Field(None, max_length=10)


class SpeciesRead(SQLModel):
    """Model for reading a species (includes ID and derived type string)"""
    id: int
    name: Optional[str] = None
    conservation_status: Optional[str] = None
    species_type_id: int
    type: str = Field(description="Species type name, derived from species_type relationship")
    scientific_name: Optional[str] = None
    nbn_atlas_guid: Optional[str] = None
    species_code: Optional[str] = None


# ============================================================================
# Species Type Models (Reference Table)
# ============================================================================

class SpeciesTypeBase(SQLModel):
    """Base species type fields"""
    name: str = Field(max_length=50, description="Internal name (e.g., 'bird')")
    display_name: str = Field(max_length=100, description="Display name (e.g., 'Bird')")


class SpeciesType(SpeciesTypeBase, table=True):  # type: ignore[call-arg]
    """Species type reference table"""
    __tablename__ = "species_type"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Relationships
    survey_types: List["SurveyType"] = Relationship(
        back_populates="species_types",
        link_model=SurveyTypeSpeciesTypeLink
    )


class SpeciesTypeRead(SpeciesTypeBase):
    """Model for reading a species type"""
    id: int


# ============================================================================
# Location Models
# ============================================================================

class LocationBase(SQLModel):
    """Base location fields"""
    name: str = Field(max_length=255, description="Location name")


class Location(LocationBase, table=True):  # type: ignore[call-arg]
    """Location database model"""
    __tablename__ = "location"

    id: Optional[int] = Field(default=None, primary_key=True)
    organisation_id: int = Field(foreign_key="organisation.id", index=True, description="Organisation this location belongs to")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Boundary fields (optional polygon for map display)
    boundary_geometry: Optional[str] = Field(
        default=None,
        sa_column=sa.Column(
            "boundary_geometry",
            sa.Text,  # PostGIS geometry stored as text, cast in queries
            nullable=True
        )
    )
    boundary_fill_color: Optional[str] = Field(default="#3388ff", max_length=7)
    boundary_stroke_color: Optional[str] = Field(default="#3388ff", max_length=7)
    boundary_fill_opacity: Optional[float] = Field(default=0.2, ge=0, le=1)

    # Relationships
    organisation: Optional["Organisation"] = Relationship(back_populates="locations")
    surveys: List["Survey"] = Relationship(back_populates="location")
    survey_types: List["SurveyType"] = Relationship(
        back_populates="locations",
        link_model=SurveyTypeLocationLink
    )
    sightings: List["Sighting"] = Relationship(back_populates="location")
    devices: List["Device"] = Relationship(back_populates="location")


class LocationCreate(LocationBase):
    """Model for creating a new location"""
    pass


class LocationUpdate(SQLModel):
    """Model for updating a location (all fields optional)"""
    name: Optional[str] = Field(None, max_length=255)


class LocationRead(LocationBase):
    """Model for reading a location (includes ID)"""
    id: int


class LocationWithBoundary(LocationRead):
    """Location with optional boundary geometry for map display"""
    boundary_geometry: Optional[List[List[float]]] = Field(
        None, description="Array of [lng, lat] coordinate pairs forming the boundary polygon"
    )
    boundary_fill_color: Optional[str] = Field(default="#3388ff")
    boundary_stroke_color: Optional[str] = Field(default="#3388ff")
    boundary_fill_opacity: Optional[float] = Field(default=0.2)


# ============================================================================
# Survey Type Models (Configuration)
# ============================================================================

class SurveyTypeBase(SQLModel):
    """Base survey type fields"""
    name: str = Field(max_length=100, description="Survey type name")
    description: Optional[str] = Field(None, description="Survey type description")
    location_at_sighting_level: bool = Field(default=False, description="If true, location is set per sighting; if false, per survey")
    allow_geolocation: bool = Field(default=True, description="Whether coordinates can be entered for sightings")
    allow_sighting_notes: bool = Field(default=True, description="Whether notes can be entered for individual sightings")
    allow_audio_upload: bool = Field(default=False, description="Whether audio files can be uploaded for this survey type")
    allow_image_upload: bool = Field(default=False, description="Whether camera trap images can be uploaded for this survey type")
    fetch_weather: bool = Field(default=False, description="Fetch weather from Open-Meteo on survey creation")
    icon: Optional[str] = Field(None, max_length=50, description="Lucide icon identifier (deprecated)")
    color: Optional[str] = Field(None, max_length=20, description="Notion-style color key (e.g., 'blue', 'purple')")


class SurveyType(SurveyTypeBase, table=True):  # type: ignore[call-arg]
    """Survey type configuration table"""
    __tablename__ = "survey_type"

    id: Optional[int] = Field(default=None, primary_key=True)
    organisation_id: int = Field(foreign_key="organisation.id", index=True, description="Organisation this survey type belongs to")
    is_active: bool = Field(default=True, description="Whether survey type is active")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Relationships
    organisation: Optional["Organisation"] = Relationship(back_populates="survey_types")
    locations: List["Location"] = Relationship(
        back_populates="survey_types",
        link_model=SurveyTypeLocationLink
    )
    species_types: List["SpeciesType"] = Relationship(
        back_populates="survey_types",
        link_model=SurveyTypeSpeciesTypeLink
    )
    surveys: List["Survey"] = Relationship(back_populates="survey_type")


class SurveyTypeCreate(SurveyTypeBase):
    """Model for creating a survey type"""
    location_ids: List[int] = Field(default_factory=list, description="List of allowed location IDs")
    species_type_ids: List[int] = Field(description="List of allowed species type IDs")


class SurveyTypeUpdate(SQLModel):
    """Model for updating a survey type (all fields optional)"""
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    location_at_sighting_level: Optional[bool] = None
    allow_geolocation: Optional[bool] = None
    allow_sighting_notes: Optional[bool] = None
    allow_audio_upload: Optional[bool] = None
    allow_image_upload: Optional[bool] = None
    fetch_weather: Optional[bool] = None
    icon: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=20)
    is_active: Optional[bool] = None
    location_ids: Optional[List[int]] = None
    species_type_ids: Optional[List[int]] = None


class SurveyTypeRead(SurveyTypeBase):
    """Model for reading a survey type"""
    id: int
    is_active: bool


class SurveyTypeWithDetails(SurveyTypeRead):
    """Survey type with full location and species type details"""
    locations: List[LocationRead] = Field(default_factory=list)
    species_types: List[SpeciesTypeRead] = Field(default_factory=list)


# ============================================================================
# Survey Models
# ============================================================================

class SurveyBase(SQLModel):
    """Base survey fields"""
    date: date_type = Field(description="Survey date")
    start_time: Optional[time_type] = Field(None, description="Survey start time")
    end_time: Optional[time_type] = Field(None, description="Survey end time")
    sun_percentage: Optional[int] = Field(None, ge=0, le=100, description="Percentage of sun (0-100)")
    temperature_celsius: Optional[Decimal] = Field(None, description="Temperature in Celsius")
    conditions_met: Optional[bool] = Field(None, description="Whether survey conditions were met")
    notes: Optional[str] = Field(None, description="Additional notes")
    location_id: Optional[int] = Field(None, foreign_key="location.id", description="Location ID (required when survey type uses survey-level location)")
    survey_type_id: Optional[int] = Field(None, foreign_key="survey_type.id", description="Survey type ID")
    device_id: Optional[int] = Field(None, foreign_key="device.id", description="Device ID (for camera trap surveys)")


class Survey(SurveyBase, table=True):  # type: ignore[call-arg]
    """Survey database model"""
    __tablename__ = "survey"

    id: Optional[int] = Field(default=None, primary_key=True)
    organisation_id: int = Field(foreign_key="organisation.id", index=True, description="Organisation this survey belongs to")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )
    weather_snapshot: Optional[dict] = Field(
        default=None,
        sa_column=sa.Column(sa.JSON, nullable=True),
        description="Weather conditions at survey time from Open-Meteo"
    )

    # Relationships
    organisation: Optional["Organisation"] = Relationship(back_populates="surveys")
    surveyors: List["Surveyor"] = Relationship(back_populates="surveys", link_model=SurveySurveyor)
    sightings: List["Sighting"] = Relationship(back_populates="survey", cascade_delete=True)
    location: Optional["Location"] = Relationship(back_populates="surveys")
    survey_type: Optional["SurveyType"] = Relationship(back_populates="surveys")
    device: Optional["Device"] = Relationship()
    audio_recordings: List["AudioRecording"] = Relationship(
        back_populates="survey",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )
    camera_trap_images: List["CameraTrapImage"] = Relationship(
        sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )


class SurveyCreate(SurveyBase):
    """Model for creating a new survey"""
    surveyor_ids: List[int] = Field(description="List of surveyor IDs")


class SurveyUpdate(SQLModel):
    """Model for updating a survey (all fields optional)"""
    date: Optional[date_type] = None
    start_time: Optional[time_type] = None
    end_time: Optional[time_type] = None
    sun_percentage: Optional[int] = Field(None, ge=0, le=100)
    temperature_celsius: Optional[Decimal] = None
    conditions_met: Optional[bool] = None
    notes: Optional[str] = None
    location_id: Optional[int] = Field(None, gt=0)
    device_id: Optional[int] = None
    surveyor_ids: Optional[List[int]] = None


class SurveyRead(SurveyBase):
    """Model for reading a survey (includes ID and surveyors)"""
    id: int
    surveyor_ids: List[int] = Field(default_factory=list, description="List of surveyor IDs")
    weather_snapshot: Optional[dict] = Field(default=None, description="Weather conditions at survey time")


class SpeciesTypeCount(SQLModel):
    """Count of sightings by species type"""
    type: str = Field(description="Species type (butterfly, bird, fungi)")
    count: int = Field(description="Number of sightings of this type")


class SurveyWithSightingsCount(SurveyRead):
    """Survey with count of sightings"""
    sightings_count: int = Field(default=0, description="Total number of sightings")
    species_breakdown: List[SpeciesTypeCount] = Field(default_factory=list, description="Breakdown by species type")


# ============================================================================
# Sighting Models
# ============================================================================

class SightingBase(SQLModel):
    """Base sighting fields"""
    species_id: int = Field(gt=0, foreign_key="species.id", description="Species ID")
    count: int = Field(gt=0, description="Number of individuals sighted")


class Sighting(SightingBase, table=True):  # type: ignore[call-arg]
    """Sighting database model"""
    __tablename__ = "sighting"

    id: Optional[int] = Field(default=None, primary_key=True)
    survey_id: int = Field(foreign_key="survey.id")
    location_id: Optional[int] = Field(None, foreign_key="location.id", description="Location ID (for sighting-level locations)")
    notes: Optional[str] = Field(None, description="Optional notes for this sighting")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Relationships
    survey: "Survey" = Relationship(back_populates="sightings")
    species: "Species" = Relationship(back_populates="sightings")
    location: Optional["Location"] = Relationship(back_populates="sightings")
    individuals: List["SightingIndividual"] = Relationship(
        back_populates="sighting",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )


class SightingUpdate(SQLModel):
    """Model for updating a sighting (all fields optional)"""
    species_id: Optional[int] = Field(None, gt=0)
    count: Optional[int] = Field(None, gt=0)
    location_id: Optional[int] = Field(None, description="Location ID (for sighting-level locations)")
    notes: Optional[str] = Field(None, description="Optional notes for this sighting")


class SightingRead(SightingBase):
    """Model for reading a sighting (includes ID)"""
    id: int
    survey_id: int
    location_id: Optional[int] = None
    notes: Optional[str] = None


class SightingWithDetails(SightingRead):
    """Sighting with species details"""
    species_name: Optional[str] = None
    species_scientific_name: Optional[str] = None
    location_name: Optional[str] = None


# ============================================================================
# Breeding Status Models (BTO Breeding Evidence Codes)
# ============================================================================

class BreedingCategory(str, PyEnum):
    """BTO breeding status categories"""
    non_breeding = "non_breeding"
    possible_breeder = "possible_breeder"
    probable_breeder = "probable_breeder"
    confirmed_breeder = "confirmed_breeder"


class BreedingStatusCode(SQLModel, table=True):  # type: ignore[call-arg]
    """BTO breeding status codes reference table"""
    __tablename__ = "breeding_status_code"

    code: str = Field(primary_key=True, max_length=2)
    description: str = Field(max_length=100)
    full_description: Optional[str] = Field(default=None, description="Full BTO description for tooltip")
    category: BreedingCategory = Field(
        sa_column=sa.Column(
            sa.Enum(BreedingCategory, name='breeding_category', create_type=False),
            nullable=False
        )
    )


class BreedingStatusCodeRead(SQLModel):
    """Model for reading a breeding status code"""
    code: str
    description: str
    full_description: Optional[str] = None
    category: str


# ============================================================================
# Sighting Individual Models (Per-Point Locations)
# ============================================================================

class SightingIndividual(SQLModel, table=True):  # type: ignore[call-arg]
    """Individual location point within a sighting with optional breeding status"""
    __tablename__ = "sighting_individual"

    id: Optional[int] = Field(default=None, primary_key=True)
    sighting_id: int = Field(foreign_key="sighting.id", ondelete="CASCADE")
    # PostGIS geometry column (not directly exposed in API - use latitude/longitude instead)
    coordinates: str = Field(
        sa_column=sa.Column(
            "coordinates",
            sa.Text,  # Will be cast to/from geometry in queries
            nullable=False
        )
    )
    count: int = Field(default=1, ge=1, description="Number of individuals at this location")
    breeding_status_code: Optional[str] = Field(
        default=None,
        foreign_key="breeding_status_code.code",
        max_length=2
    )
    notes: Optional[str] = Field(default=None)
    camera_trap_image_id: Optional[int] = Field(
        default=None,
        foreign_key="camera_trap_image.id"
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Relationships
    sighting: "Sighting" = Relationship(back_populates="individuals")
    breeding_status: Optional["BreedingStatusCode"] = Relationship()
    camera_trap_image: Optional["CameraTrapImage"] = Relationship()


class IndividualLocationBase(SQLModel):
    """Base individual location fields for API"""
    latitude: float = Field(ge=-90, le=90, description="Latitude coordinate (WGS84)")
    longitude: float = Field(ge=-180, le=180, description="Longitude coordinate (WGS84)")
    count: int = Field(default=1, ge=1, description="Number of individuals at this location")
    breeding_status_code: Optional[str] = Field(None, max_length=2, description="BTO breeding status code")
    notes: Optional[str] = Field(None, description="Optional notes for this individual")
    camera_trap_image_id: Optional[int] = Field(None)


class IndividualLocationCreate(IndividualLocationBase):
    """Model for creating an individual location"""
    pass


class IndividualLocationRead(IndividualLocationBase):
    """Model for reading an individual location"""
    id: int


class AudioDetectionCreate(SQLModel):
    """Model for creating a bird detection linked to a sighting"""
    audio_recording_id: int = Field(description="Audio recording ID")
    species_name: str = Field(description="BirdNET species name (Scientific_Common)")
    confidence: float = Field(ge=0, le=1, description="Detection confidence")
    start_time: str = Field(description="Start time within audio file (HH:MM:SS)")
    end_time: str = Field(description="End time within audio file (HH:MM:SS)")


class SightingCreate(SightingBase):
    """Model for creating a sighting with individual locations"""
    location_id: Optional[int] = Field(None, description="Location ID (for sighting-level locations)")
    notes: Optional[str] = Field(None, description="Optional notes for this sighting")
    individuals: List[IndividualLocationCreate] = Field(default_factory=list, description="Individual location points")
    image_ids: List[int] = Field(default_factory=list, description="Camera trap image IDs to link")
    audio_detections: List[AudioDetectionCreate] = Field(default_factory=list, description="Bird detections to link")


class SightingAudioClip(SQLModel):
    """Audio clip info returned with a sighting"""
    confidence: float
    audio_recording_id: int
    start_time: time_type
    end_time: time_type


class SightingWithIndividuals(SightingWithDetails):
    """Sighting with individual location points"""
    individuals: List[IndividualLocationRead] = Field(default_factory=list, description="Individual location points")
    image_ids: List[int] = Field(default_factory=list, description="Linked camera trap image IDs")
    audio_clips: List[SightingAudioClip] = Field(default_factory=list, description="Linked audio detection clips")


# ============================================================================
# Sighting Image Junction Table
# ============================================================================

class SightingImage(SQLModel, table=True):  # type: ignore[call-arg]
    """Junction table linking sightings to camera trap images (many-to-many)"""
    __tablename__ = "sighting_image"
    __table_args__ = (
        sa.UniqueConstraint('sighting_id', 'camera_trap_image_id', name='uq_sighting_image'),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    sighting_id: int = Field(foreign_key="sighting.id", ondelete="CASCADE", index=True)
    camera_trap_image_id: int = Field(foreign_key="camera_trap_image.id", ondelete="CASCADE", index=True)
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )


# ============================================================================
# Dashboard Models
# ============================================================================

class CumulativeSpeciesDataPoint(SQLModel):
    """Single data point for cumulative species chart"""
    date: date_type = Field(description="Survey date")
    type: str = Field(description="Species type")
    cumulative_count: int = Field(description="Cumulative unique species count up to this date")
    new_species: List[str] = Field(default_factory=list, description="Names of new species first seen on this date")


class DateRange(SQLModel):
    """Date range metadata"""
    start: date_type = Field(description="Start date")
    end: date_type = Field(description="End date")


class CumulativeSpeciesResponse(SQLModel):
    """Response for cumulative species endpoint"""
    data: List[CumulativeSpeciesDataPoint] = Field(description="Cumulative species data points")
    date_range: DateRange = Field(description="Date range of the data")


class SpeciesOccurrenceDataPoint(SQLModel):
    """Single data point for species occurrence chart"""
    survey_date: date_type = Field(description="Survey date")
    survey_id: int = Field(description="Survey ID")
    occurrence_count: int = Field(description="Total count of individuals seen in this survey")


class SpeciesOccurrenceResponse(SQLModel):
    """Response for species occurrence endpoint"""
    data: List[SpeciesOccurrenceDataPoint] = Field(description="Occurrence data points by survey")
    date_range: DateRange = Field(description="Date range of the data")
    species_name: str = Field(description="Name of the species")


class SpeciesWithCount(SQLModel):
    """Species with total occurrence count"""
    id: int = Field(description="Species ID")
    name: Optional[str] = Field(description="Common name")
    scientific_name: Optional[str] = Field(description="Scientific name")
    type: str = Field(description="Species type")
    total_count: int = Field(description="Total occurrence count across all surveys")


# ============================================================================
# Audio Recording Models (Bird Audio Analysis)
# ============================================================================

class ProcessingStatus(str, PyEnum):
    """Processing status for audio recordings"""
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class AudioRecordingBase(SQLModel):
    """Base audio recording fields"""
    filename: str = Field(max_length=255, description="Original filename")
    recording_timestamp: Optional[datetime] = Field(None, description="Timestamp extracted from filename")
    device_serial: Optional[str] = Field(None, max_length=50, description="Device serial number")
    unmatched_species: Optional[List[str]] = Field(
        default=None,
        sa_column=sa.Column(sa.JSON, nullable=True),
        description="Species detected by BirdNET but not found in database"
    )


class AudioRecording(AudioRecordingBase, table=True):  # type: ignore[call-arg]
    """Audio recording database model"""
    __tablename__ = "audio_recording"

    id: Optional[int] = Field(default=None, primary_key=True)
    survey_id: int = Field(foreign_key="survey.id", ondelete="CASCADE", index=True)
    r2_key: str = Field(max_length=500, unique=True, description="R2 storage key")
    file_size_bytes: Optional[int] = Field(None)
    duration_seconds: Optional[float] = Field(None)

    processing_status: ProcessingStatus = Field(
        default=ProcessingStatus.pending,
        sa_column=sa.Column(sa.String(20), nullable=False, server_default="pending")
    )
    processing_started_at: Optional[datetime] = Field(None)
    processing_completed_at: Optional[datetime] = Field(None)
    processing_error: Optional[str] = Field(None)

    uploaded_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Relationships
    survey: "Survey" = Relationship(back_populates="audio_recordings")
    detections: List["AudioDetection"] = Relationship(
        back_populates="audio_recording",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )


class AudioRecordingRead(AudioRecordingBase):
    """Model for reading audio recording"""
    id: int
    survey_id: int
    r2_key: str
    file_size_bytes: Optional[int]
    duration_seconds: Optional[float]
    processing_status: str
    processing_error: Optional[str]
    uploaded_at: datetime
    detection_count: int = 0
    unmatched_species: Optional[List[str]] = None


class AudioDetectionBase(SQLModel):
    """Base audio detection fields"""
    species_name: str = Field(max_length=255)
    confidence: float = Field(ge=0, le=1)
    start_time: time_type
    end_time: time_type
    detection_timestamp: datetime


class AudioDetection(AudioDetectionBase, table=True):  # type: ignore[call-arg]
    """Audio detection database model"""
    __tablename__ = "audio_detection"

    id: Optional[int] = Field(default=None, primary_key=True)
    audio_recording_id: int = Field(foreign_key="audio_recording.id", ondelete="CASCADE", index=True)
    species_id: int = Field(foreign_key="species.id", ondelete="CASCADE")
    sighting_id: Optional[int] = Field(default=None, foreign_key="sighting.id", ondelete="SET NULL", index=True)

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Relationships
    audio_recording: "AudioRecording" = Relationship(back_populates="detections")
    species: "Species" = Relationship()
    sighting: Optional["Sighting"] = Relationship()


class AudioDetectionRead(AudioDetectionBase):
    """Model for reading audio detection"""
    id: int
    species_id: Optional[int]
    species_common_name: Optional[str] = None


# ============================================================================
# Detections Summary Models (Aggregated by Species)
# ============================================================================

class DetectionClip(SQLModel):
    """Single detection with audio playback info and device context"""
    confidence: float = Field(description="Detection confidence (0-1)")
    audio_recording_id: int = Field(description="Audio recording ID for fetching download URL")
    start_time: time_type = Field(description="Start time within the audio file")
    end_time: time_type = Field(description="End time within the audio file")
    # Device info for location attribution
    device_id: Optional[str] = Field(None, description="Device serial number")
    device_name: Optional[str] = Field(None, description="Device friendly name")
    device_latitude: Optional[float] = Field(None, description="Device GPS latitude")
    device_longitude: Optional[float] = Field(None, description="Device GPS longitude")
    location_id: Optional[int] = Field(None, description="Location ID from device")
    location_name: Optional[str] = Field(None, description="Location name from device")


class SpeciesDetectionSummary(SQLModel):
    """Summary of detections for a single species"""
    species_id: int = Field(description="Species ID")
    species_name: Optional[str] = Field(description="Species common name")
    species_scientific_name: Optional[str] = Field(description="Species scientific name")
    detection_count: int = Field(description="Total number of detections for this species")
    top_detections: List[DetectionClip] = Field(
        default_factory=list,
        description="Top 3 detections sorted by confidence (highest first)"
    )


class SurveyDetectionsSummaryResponse(SQLModel):
    """Response for survey detections summary endpoint"""
    species_summaries: List[SpeciesDetectionSummary] = Field(
        default_factory=list,
        description="List of species with their detection summaries"
    )


# ============================================================================
# Audio Processing Models (Wizard - process without storage)
# ============================================================================

class AudioDetectionResult(SQLModel):
    """Single detection result from BirdNET processing"""
    species_name: str = Field(description="BirdNET species string (Scientific_Common)")
    species_id: Optional[int] = Field(None, description="Matched DB species ID")
    species_common_name: Optional[str] = Field(None, description="DB common name")
    species_scientific_name: Optional[str] = Field(None, description="DB scientific name")
    confidence: float = Field(description="Detection confidence (0-1)")
    start_time: str = Field(description="Start time HH:MM:SS")
    end_time: str = Field(description="End time HH:MM:SS")


class FileProcessingResult(SQLModel):
    """Processing results for a single audio file"""
    filename: str
    detections: List[AudioDetectionResult] = Field(default_factory=list)
    unmatched_species: List[str] = Field(default_factory=list)


class AudioProcessingResponse(SQLModel):
    """Response from the process-audio endpoint"""
    results: List[FileProcessingResult] = Field(default_factory=list)


# ============================================================================
# Camera Trap Image Models
# ============================================================================

class CameraTrapImageBase(SQLModel):
    """Base camera trap image fields"""
    filename: str = Field(max_length=255, description="Original filename")
    image_timestamp: Optional[datetime] = Field(None, description="Timestamp from EXIF or filename")
    device_serial: Optional[str] = Field(None, max_length=50, description="Device serial number from filename")
    flagged_for_review: bool = Field(default=False, description="Whether image needs manual review")
    review_reason: Optional[str] = Field(None, max_length=255, description="Reason for flagging")
    unmatched_species: Optional[List[str]] = Field(
        default=None,
        sa_column=sa.Column(sa.JSON, nullable=True),
        description="Species detected but not found in database"
    )
    megadetector_confidence: Optional[float] = Field(
        None, description="MegaDetector animal detection confidence (null = not scanned)"
    )
    is_false_positive: bool = Field(
        default=False, description="Whether image was marked as false positive (no animal)"
    )


class CameraTrapImage(CameraTrapImageBase, table=True):  # type: ignore[call-arg]
    """Camera trap image database model"""
    __tablename__ = "camera_trap_image"

    id: Optional[int] = Field(default=None, primary_key=True)
    survey_id: int = Field(foreign_key="survey.id", ondelete="CASCADE", index=True)
    r2_key: str = Field(max_length=500, unique=True, description="R2 storage key")
    file_size_bytes: Optional[int] = Field(None)

    processing_status: ProcessingStatus = Field(
        default=ProcessingStatus.pending,
        sa_column=sa.Column(sa.String(20), nullable=False, server_default="pending")
    )
    processing_started_at: Optional[datetime] = Field(None)
    processing_completed_at: Optional[datetime] = Field(None)
    processing_error: Optional[str] = Field(None)

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Relationships
    survey: "Survey" = Relationship()
    detections: List["CameraTrapDetection"] = Relationship(
        back_populates="camera_trap_image",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )


class CameraTrapImageRead(CameraTrapImageBase):
    """Model for reading camera trap image"""
    id: int
    survey_id: int
    r2_key: str
    file_size_bytes: Optional[int]
    processing_status: str
    processing_error: Optional[str]
    created_at: datetime
    detection_count: int = 0


class CameraTrapDetectionBase(SQLModel):
    """Base camera trap detection fields"""
    species_name: str = Field(max_length=255, description="Common name")
    scientific_name: str = Field(max_length=255, description="Scientific name")
    confidence: float = Field(ge=0, le=1)
    taxonomic_level: Optional[str] = Field(None, max_length=50, description="Taxonomic level of classification")
    is_primary: bool = Field(default=True, description="Whether this is the top prediction")


class CameraTrapDetection(CameraTrapDetectionBase, table=True):  # type: ignore[call-arg]
    """Camera trap detection database model"""
    __tablename__ = "camera_trap_detection"

    id: Optional[int] = Field(default=None, primary_key=True)
    camera_trap_image_id: int = Field(foreign_key="camera_trap_image.id", ondelete="CASCADE", index=True)
    species_id: Optional[int] = Field(None, foreign_key="species.id", ondelete="SET NULL", description="Link to Species table if matched")

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Relationships
    camera_trap_image: "CameraTrapImage" = Relationship(back_populates="detections")
    species: Optional["Species"] = Relationship()


class CameraTrapDetectionRead(CameraTrapDetectionBase):
    """Model for reading camera trap detection"""
    id: int
    species_id: Optional[int]


# ============================================================================
# Camera Trap Detection Summary Models
# ============================================================================

class ImageDetectionClip(SQLModel):
    """Single image detection with preview info and device context"""
    confidence: float = Field(description="Detection confidence (0-1)")
    camera_trap_image_id: int = Field(description="Image ID for fetching preview URL")
    # Device info for location attribution
    device_id: Optional[str] = Field(None, description="Device serial number")
    device_name: Optional[str] = Field(None, description="Device friendly name")
    device_latitude: Optional[float] = Field(None, description="Device GPS latitude")
    device_longitude: Optional[float] = Field(None, description="Device GPS longitude")
    location_id: Optional[int] = Field(None, description="Location ID from device")
    location_name: Optional[str] = Field(None, description="Location name from device")


class ImageSpeciesDetectionSummary(SQLModel):
    """Summary of image detections for a single species"""
    species_id: Optional[int] = Field(description="Species ID if matched")
    species_name: str = Field(description="Species common name")
    species_scientific_name: str = Field(description="Species scientific name")
    detection_count: int = Field(description="Total number of detections for this species")
    top_detections: List[ImageDetectionClip] = Field(
        default_factory=list,
        description="Top 3 detections sorted by confidence (highest first)"
    )


class SurveyImageDetectionsSummaryResponse(SQLModel):
    """Response for survey image detections summary endpoint (DEPRECATED - use SurveyImageDetectionsResponse)"""
    species_summaries: List[ImageSpeciesDetectionSummary] = Field(
        default_factory=list,
        description="List of species with their detection summaries"
    )


class ImageDetectionOption(SQLModel):
    """A single species detection option for an image"""
    species_id: Optional[int] = Field(None, description="Species ID if matched in database")
    species_name: Optional[str] = Field(None, description="Species common name")
    scientific_name: str = Field(description="Species scientific name")
    confidence: float = Field(description="Detection confidence (0-1)")


class ImageWithDetections(SQLModel):
    """An image with its top species detection options"""
    image_id: int = Field(description="Camera trap image ID")
    filename: str = Field(description="Original filename")
    device_id: Optional[str] = Field(None, description="Device serial number")
    device_name: Optional[str] = Field(None, description="Device friendly name")
    device_latitude: Optional[float] = Field(None, description="Device GPS latitude")
    device_longitude: Optional[float] = Field(None, description="Device GPS longitude")
    location_id: Optional[int] = Field(None, description="Location ID from device")
    location_name: Optional[str] = Field(None, description="Location name from device")
    detections: List[ImageDetectionOption] = Field(
        default_factory=list,
        description="Top 3 species detections sorted by confidence"
    )


class SurveyImageDetectionsResponse(SQLModel):
    """Response for survey image detections endpoint - one row per image"""
    images: List[ImageWithDetections] = Field(
        default_factory=list,
        description="List of images with their detection options"
    )
