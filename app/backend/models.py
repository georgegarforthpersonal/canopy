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
from typing import Optional, List, Dict, Any
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
    refugia = "refugia"
    moth_light_trap = "moth_light_trap"


class SurveyStatus(str, PyEnum):
    """Lifecycle of a survey.

    - scheduled: planned/assigned, not yet carried out
    - completed: the survey took place and was recorded (any sighting count,
      including a valid nil count of zero)
    - cancelled: scheduled but did not happen (e.g. weather, no-shows)
    """
    scheduled = "scheduled"
    completed = "completed"
    cancelled = "cancelled"


class ScheduleCadence(str, PyEnum):
    """How surveys of a type are scheduled.

    - date: scheduled for a specific day (scheduled date == survey date).
    - weekly: scheduled for a whole week; the survey may be carried out any day
      within the window (``scheduled_window_start`` .. ``scheduled_window_end``).
    """
    date = "date"
    weekly = "weekly"


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
# User / Account Models
# ============================================================================

class UserRole(str, PyEnum):
    """Access level of a user account, strictly ordered.

    - viewer: read access; may sign themselves up to scheduled surveys
    - editor: viewer + create/edit surveys and media
    - admin: editor + admin page (devices, locations, survey types,
      surveyors, species) and user/invite management
    """
    viewer = "viewer"
    editor = "editor"
    admin = "admin"


class UserBase(SQLModel):
    """Base user fields shared between Create and Read"""
    email: str = Field(max_length=255, description="Login email (lowercased)")
    first_name: str = Field(max_length=255, description="User's first name")
    last_name: Optional[str] = Field(default=None, max_length=255, description="User's last name (optional)")


class User(UserBase, table=True):  # type: ignore[call-arg]
    """User account, scoped to one organisation.

    Named app_user because "user" is a reserved word in Postgres.
    """
    __tablename__ = "app_user"
    __table_args__ = (
        sa.UniqueConstraint('organisation_id', 'email', name='uq_app_user_org_email'),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    organisation_id: int = Field(foreign_key="organisation.id", index=True, description="Organisation this user belongs to")
    password_hash: str = Field(max_length=255, description="argon2id password hash")
    role: UserRole = Field(
        sa_column=sa.Column("role", sa.String(20), nullable=False),
        description="Access level: viewer, editor or admin",
    )
    is_active: bool = Field(default=True, description="Inactive users cannot log in; their sessions are revoked")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )
    last_login_at: Optional[datetime] = Field(default=None, description="Time of most recent successful login")
    # One active password reset at a time; hash only, the raw token is emailed
    password_reset_token_hash: Optional[str] = Field(default=None, max_length=64)
    password_reset_expires_at: Optional[datetime] = Field(default=None)


class UserRead(UserBase):
    """User as returned to admins and as /auth/me identity"""
    id: int
    role: UserRole
    is_active: bool
    created_at: datetime
    last_login_at: Optional[datetime] = None


class UserSession(SQLModel, table=True):  # type: ignore[call-arg]
    """Server-side login session; the cookie/bearer token is stored hashed.

    DB-backed (rather than a signed stateless token) so deactivating a user
    or changing their role takes effect immediately.
    """
    __tablename__ = "user_session"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="app_user.id", index=True, ondelete="CASCADE")
    token_hash: str = Field(max_length=64, unique=True, index=True, description="sha256 of the session token")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )
    expires_at: datetime = Field(description="Sliding expiry, extended on activity")
    last_seen_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class Invite(SQLModel, table=True):  # type: ignore[call-arg]
    """Invitation to create an account, emailed as a single-use link"""
    __tablename__ = "invite"

    id: Optional[int] = Field(default=None, primary_key=True)
    organisation_id: int = Field(foreign_key="organisation.id", index=True)
    email: str = Field(max_length=255, description="Invited email (lowercased)")
    role: UserRole = Field(
        sa_column=sa.Column("role", sa.String(20), nullable=False),
        description="Role the account will get on acceptance",
    )
    token_hash: str = Field(max_length=64, unique=True, index=True, description="sha256 of the invite token")
    invited_by_user_id: Optional[int] = Field(default=None, foreign_key="app_user.id")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )
    expires_at: datetime = Field(description="Invites are valid for 7 days")
    accepted_at: Optional[datetime] = Field(default=None, description="Set once used; used invites cannot be reused")


class InviteRead(SQLModel):
    """Invite as listed on the admin Users tab"""
    id: int
    email: str
    role: UserRole
    created_at: datetime
    expires_at: datetime
    accepted_at: Optional[datetime] = None


# ============================================================================
# Device Models (Audio Recorder Devices)
# ============================================================================

class DeviceBase(SQLModel):
    """Base device fields"""
    device_id: str = Field(max_length=50, description="Internal unique device identifier (auto-generated)")
    name: str = Field(max_length=255, description="Friendly name for the device (shown to end users)")
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

    # PostGIS Point geometry (stored as text, cast in queries).
    # NOT NULL: every device must be mappable so sightings can inherit coordinates.
    point_geometry: str = Field(
        sa_column=sa.Column(
            "point_geometry",
            sa.Text,  # PostGIS geometry stored as text, cast in queries
            nullable=False
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
    # Auto-generated server-side when omitted; no longer a user-entered serial.
    device_id: Optional[str] = Field(None, max_length=50)  # type: ignore[assignment]
    latitude: float = Field(ge=-90, le=90, description="Latitude coordinate")
    longitude: float = Field(ge=-180, le=180, description="Longitude coordinate")
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
    latitude: float
    longitude: float
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
    # A surveyor may be linked to a user account so that user can sign
    # themselves up to scheduled surveys. Historical surveyors stay unlinked.
    user_id: Optional[int] = Field(default=None, foreign_key="app_user.id", unique=True)
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
    # Lets the frontend find the caller's own surveyor for self-signup state
    user_id: Optional[int] = None


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

class LocationType(str, PyEnum):
    """Spatial representation of a location.

    Stored as a plain string column (like ``DeviceType``); the enum is enforced
    at the Python layer.
    """
    area = "area"      # polygon boundary
    route = "route"    # line / transect route
    point = "point"    # single point
    none = "none"      # no GPS geometry
    sector = "sector"  # a sub-segment of a route (has a parent route location)


# GeoJSON geometry types accepted for each location type
GEOMETRY_TYPES_BY_LOCATION_TYPE: Dict[LocationType, set[str]] = {
    LocationType.area: {"Polygon", "MultiPolygon"},
    LocationType.route: {"LineString", "MultiLineString"},
    LocationType.point: {"Point", "MultiPoint"},
    LocationType.none: set(),
    # A sector is geometrically a line, just like a route.
    LocationType.sector: {"LineString", "MultiLineString"},
}


class LocationBase(SQLModel):
    """Base location fields"""
    name: str = Field(max_length=255, description="Location name")
    location_type: LocationType = Field(
        default=LocationType.none,
        description="Spatial representation of this location (area / route / point / none)",
    )


class Location(LocationBase, table=True):  # type: ignore[call-arg]
    """Location database model"""
    __tablename__ = "location"

    id: Optional[int] = Field(default=None, primary_key=True)
    organisation_id: int = Field(foreign_key="organisation.id", index=True, description="Organisation this location belongs to")
    # For sectors (location_type == "sector"): the parent route this sector
    # belongs to. NULL for all top-level locations. Deleting a route removes
    # its sectors via the FK's ON DELETE CASCADE.
    parent_location_id: Optional[int] = Field(
        default=None,
        sa_column=sa.Column(
            "parent_location_id",
            sa.Integer,
            sa.ForeignKey("location.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )
    # Ordering of sectors within their parent route (1-based). NULL for non-sectors.
    ordinal: Optional[int] = Field(default=None, description="Sector order within its parent route")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )

    # Geometry (optional). PostGIS column is geometry(Geometry, 4326) so it can
    # hold a Polygon (area), LineString (route) or Point depending on location_type.
    # Mapped as Text here; reads/writes go through ST_* functions in the router.
    boundary_geometry: Optional[str] = Field(
        default=None,
        sa_column=sa.Column(
            "boundary_geometry",
            sa.Text,  # PostGIS geometry stored as text, cast in queries
            nullable=True
        )
    )

    # Relationships
    organisation: Optional["Organisation"] = Relationship(back_populates="locations")
    surveys: List["Survey"] = Relationship(back_populates="location")
    survey_types: List["SurveyType"] = Relationship(
        back_populates="locations",
        link_model=SurveyTypeLocationLink
    )
    sightings: List["Sighting"] = Relationship(back_populates="location")
    devices: List["Device"] = Relationship(back_populates="location")


class SectorInput(SQLModel):
    """A sector (sub-segment) of a route, supplied when creating/updating a route.

    Sectors are persisted as child ``Location`` rows (location_type == "sector")
    pointing at the parent route via ``parent_location_id``. Their order is the
    order of the array (ordinal is assigned server-side, 1-based).
    """
    id: Optional[int] = Field(default=None, description="Existing sector id, if updating in place")
    name: str = Field(max_length=255)
    geometry: Dict[str, Any] = Field(description="GeoJSON LineString for this sector")


class SectorRead(SQLModel):
    """A sector nested under its parent route for map/list display."""
    id: int
    name: str
    ordinal: int
    geometry: Optional[Dict[str, Any]] = None


class LocationCreate(LocationBase):
    """Model for creating a new location, optionally with geometry."""
    geometry: Optional[Dict[str, Any]] = Field(
        default=None,
        description="GeoJSON geometry (Polygon/LineString/Point) matching location_type",
    )
    # Sectors of a route (only meaningful when location_type == "route").
    sectors: Optional[List[SectorInput]] = Field(
        default=None,
        description="Ordered sub-segments of a route, persisted as child locations",
    )


class LocationUpdate(SQLModel):
    """Model for updating a location (all fields optional).

    Geometry handling uses ``model_fields_set`` in the router to distinguish an
    omitted ``geometry`` (leave unchanged) from an explicit ``null`` (clear it).
    The same convention applies to ``sectors``: omitted leaves them untouched, an
    explicit list replaces the full set (insert/update/delete to match).
    """
    name: Optional[str] = Field(None, max_length=255)
    location_type: Optional[LocationType] = None
    geometry: Optional[Dict[str, Any]] = None
    sectors: Optional[List[SectorInput]] = None


class LocationRead(LocationBase):
    """Model for reading a location (includes ID)"""
    id: int
    # Name of the parent route for a sector (null for top-level locations), so
    # clients can display children as "<parent> - child".
    parent_name: Optional[str] = None
    # Sector order within its parent route (null for top-level locations), so
    # clients can render standalone sectors in route order.
    ordinal: Optional[int] = None


class LocationWithBoundary(LocationRead):
    """Location with optional geometry for map display."""
    geometry: Optional[Dict[str, Any]] = Field(
        None, description="GeoJSON geometry (Polygon/LineString/Point)"
    )
    # Polygon outer ring as [lng, lat] pairs — kept for backward compatibility
    # with existing boundary overlays; null for non-area locations.
    boundary_geometry: Optional[List[List[float]]] = Field(
        None, description="Array of [lng, lat] coordinate pairs forming the boundary polygon"
    )
    # Sub-segments of a route, ordered by ordinal. Empty/absent for non-routes.
    sectors: Optional[List[SectorRead]] = Field(
        None, description="Ordered sectors of this route (child locations)"
    )


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
    allow_sighting_photo_upload: bool = Field(default=False, description="Whether photos can be attached to individual sightings for documentation")
    allow_start_end_time: bool = Field(default=False, description="Whether start/end time fields are shown for this survey type")
    allow_sun_percentage: bool = Field(default=False, description="Whether sun percentage field is shown for this survey type")
    allow_temperature: bool = Field(default=False, description="Whether temperature field is shown for this survey type")
    allow_show_description: bool = Field(default=False, description="Whether survey type description is displayed to surveyors")
    allow_sighting_device_selection: bool = Field(default=False, description="If true, each sighting is attached to a device and inherits its location")
    sighting_device_type: Optional[DeviceType] = Field(
        default=None,
        sa_column=sa.Column("sighting_device_type", sa.String(20), nullable=True),
        description="Device type used for sighting device selection (required when allow_sighting_device_selection is true)"
    )
    icon: Optional[str] = Field(None, max_length=50, description="Lucide icon identifier (deprecated)")
    color: Optional[str] = Field(None, max_length=20, description="Notion-style color key (e.g., 'blue', 'purple')")
    schedule_cadence: ScheduleCadence = Field(
        default=ScheduleCadence.date,
        sa_column=sa.Column("schedule_cadence", sa.String(20), nullable=False, server_default="date"),
        description="Whether surveys of this type are scheduled for a specific day or a whole week",
    )


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
    allow_sighting_photo_upload: Optional[bool] = None
    allow_start_end_time: Optional[bool] = None
    allow_sun_percentage: Optional[bool] = None
    allow_temperature: Optional[bool] = None
    allow_show_description: Optional[bool] = None
    allow_sighting_device_selection: Optional[bool] = None
    sighting_device_type: Optional[DeviceType] = None
    icon: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=20)
    schedule_cadence: Optional[ScheduleCadence] = None
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
# Survey Type File Models (reference files: methodology PDFs, recording forms)
# ============================================================================

class SurveyTypeFile(SQLModel, table=True):  # type: ignore[call-arg]
    """A reference file attached to a survey type, stored in R2."""
    __tablename__ = "survey_type_file"

    id: Optional[int] = Field(default=None, primary_key=True)
    survey_type_id: int = Field(
        foreign_key="survey_type.id", ondelete="CASCADE", index=True,
        description="Survey type this file belongs to"
    )
    organisation_id: int = Field(foreign_key="organisation.id", index=True)
    filename: str = Field(max_length=255, description="Original filename as uploaded")
    content_type: Optional[str] = Field(default=None, max_length=100, description="MIME type")
    size_bytes: Optional[int] = Field(default=None, description="File size in bytes")
    r2_key: str = Field(max_length=500, unique=True, description="R2 storage key")
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"server_default": sa.text("CURRENT_TIMESTAMP")}
    )


class SurveyTypeFileRead(SQLModel):
    """Model for reading a survey type file (no R2 key exposed)."""
    id: int
    survey_type_id: int
    filename: str
    content_type: Optional[str]
    size_bytes: Optional[int]
    created_at: datetime


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
    status: SurveyStatus = Field(
        default=SurveyStatus.completed,
        sa_column=sa.Column("status", sa.String(20), nullable=False, server_default="completed"),
        description="Survey lifecycle: scheduled, completed (recorded, incl. nil counts) or cancelled",
    )
    # Scheduling window for weekly-cadence survey types: the survey may be carried
    # out any day in [start, end]. Null for day-precise schedules, where ``date``
    # is the scheduled day. On completion ``date`` records the actual day.
    scheduled_window_start: Optional[date_type] = Field(
        None, description="First day of the scheduling window (weekly cadence); null for day-precise"
    )
    scheduled_window_end: Optional[date_type] = Field(
        None, description="Last day of the scheduling window (weekly cadence); null for day-precise"
    )


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


class SurveyScheduleCreate(SQLModel):
    """Bulk-schedule a recurring series of surveys.

    Creates one `scheduled` survey per date, sharing the same survey type,
    location and (optionally) pre-assigned surveyors. Used by the admin
    scheduling UI; the frontend expands the recurrence rule into explicit dates.
    """
    survey_type_id: Optional[int] = Field(None, description="Survey type for every scheduled survey")
    location_id: Optional[int] = Field(None, gt=0, description="Survey-level location (when the type uses one)")
    surveyor_ids: List[int] = Field(default_factory=list, description="Surveyors pre-assigned to every survey")
    notes: Optional[str] = Field(None, description="Optional note applied to every survey")
    dates: List[date_type] = Field(..., min_length=1, max_length=104, description="One survey is created per date")


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
    status: Optional[SurveyStatus] = None
    surveyor_ids: Optional[List[int]] = None


class SurveyRead(SurveyBase):
    """Model for reading a survey (includes ID and surveyors)"""
    id: int
    surveyor_ids: List[int] = Field(default_factory=list, description="List of surveyor IDs")
    location_name: Optional[str] = Field(None, description="Name of the survey's location, regardless of current survey-type config")


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
    device_id: Optional[int] = Field(None, foreign_key="device.id", description="Device ID (for sighting-level device selection)")
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
    device: Optional["Device"] = Relationship()
    individuals: List["SightingIndividual"] = Relationship(
        back_populates="sighting",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )


class SightingUpdate(SQLModel):
    """Model for updating a sighting (all fields optional)"""
    species_id: Optional[int] = Field(None, gt=0)
    count: Optional[int] = Field(None, gt=0)
    location_id: Optional[int] = Field(None, description="Location ID (for sighting-level locations)")
    device_id: Optional[int] = Field(None, description="Device ID (for sighting-level device selection)")
    notes: Optional[str] = Field(None, description="Optional notes for this sighting")
    image_ids: Optional[List[int]] = Field(None, description="Camera trap image IDs to link via junction table")


class SightingRead(SightingBase):
    """Model for reading a sighting (includes ID)"""
    id: int
    survey_id: int
    location_id: Optional[int] = None
    device_id: Optional[int] = None
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
    detection_timestamp: Optional[datetime] = Field(
        None,
        description="Absolute wall-clock time of the detection; if omitted, derived from recording_timestamp"
    )


class SightingCreate(SightingBase):
    """Model for creating a sighting with individual locations"""
    location_id: Optional[int] = Field(None, description="Location ID (for sighting-level locations)")
    device_id: Optional[int] = Field(None, description="Device ID (for sighting-level device selection)")
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
    detection_timestamp: Optional[datetime] = None


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
    first_observed: Optional[date_type] = Field(default=None, description="Date of the earliest survey recording this species")


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
    processing_attempts: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer, nullable=False, server_default="0"),
    )

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


class ProcessingSummary(SQLModel):
    """Counts of media rows by processing status for a survey."""
    pending: int = 0
    processing: int = 0
    completed: int = 0
    failed: int = 0
    total: int = 0


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
    audio_recording_id: Optional[int] = Field(
        default=None, foreign_key="audio_recording.id", ondelete="CASCADE", index=True
    )
    survey_id: Optional[int] = Field(
        default=None, foreign_key="survey.id", ondelete="CASCADE", index=True
    )
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
    detection_timestamp: Optional[datetime] = Field(
        None,
        description="Absolute wall-clock time of the detection (recording start + start_time)"
    )


class FileProcessingResult(SQLModel):
    """Processing results for a single audio file"""
    filename: str
    detections: List[AudioDetectionResult] = Field(default_factory=list)
    unmatched_species: List[str] = Field(default_factory=list)


class AudioProcessingResponse(SQLModel):
    """Response from the process-audio endpoint"""
    results: List[FileProcessingResult] = Field(default_factory=list)


class SurveyDetectionSave(SQLModel):
    """One BirdNET detection to persist against a survey (no audio file)."""
    species_id: int = Field(description="DB species ID")
    species_name: str = Field(description="BirdNET species string (Scientific_Common)")
    confidence: float = Field(ge=0, le=1)
    start_time: str = Field(description="Start time within source file (HH:MM:SS)")
    end_time: str = Field(description="End time within source file (HH:MM:SS)")
    detection_timestamp: datetime = Field(description="Absolute wall-clock time of the detection")


class SurveyDetectionsSaveRequest(SQLModel):
    detections: List[SurveyDetectionSave] = Field(default_factory=list)


class SurveyDetectionsSaveResponse(SQLModel):
    created: int


# ============================================================================
# Camera Trap Image Models
# ============================================================================

class CameraTrapImageBase(SQLModel):
    """Base camera trap image fields"""
    filename: str = Field(max_length=255, description="Original filename")
    image_timestamp: Optional[datetime] = Field(None, description="Timestamp from EXIF or filename")
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
    processing_attempts: int = Field(
        default=0,
        sa_column=sa.Column(sa.Integer, nullable=False, server_default="0"),
    )

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
