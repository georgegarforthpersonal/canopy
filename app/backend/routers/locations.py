"""
Locations Router - API endpoints for location management

Endpoints:
  GET    /api/locations                 - List all locations
  GET    /api/locations/with-boundaries - List all locations with geometry
  POST   /api/locations                 - Create new location
  GET    /api/locations/{id}            - Get specific location
  PUT    /api/locations/{id}            - Update location
  DELETE /api/locations/{id}            - Delete location

Geometry (polygon area, line route, or point) is stored in a single PostGIS
``geometry(Geometry, 4326)`` column. Clients send/receive GeoJSON; conversion
to/from PostGIS happens via ST_GeomFromGeoJSON / ST_AsGeoJSON.
"""

import json
from fastapi import APIRouter, HTTPException, status, Depends
from typing import List, Any, Optional, Dict
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import DataError, InternalError, ProgrammingError
from database.connection import get_db
from models import (
    Location,
    LocationRead,
    LocationCreate,
    LocationUpdate,
    LocationWithBoundary,
    LocationType,
    GEOMETRY_TYPES_BY_LOCATION_TYPE,
    Organisation,
)
from auth import require_admin
from dependencies import get_current_organisation

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _validate_geometry(
    location_type: LocationType, geometry: Optional[Dict[str, Any]]
) -> None:
    """Validate that a GeoJSON geometry is consistent with the location type.

    Raises HTTP 422 on mismatch. A null geometry is always allowed (a location
    may have a type chosen but no shape drawn yet); a ``none`` location must not
    carry geometry.
    """
    if geometry is None:
        return

    if location_type == LocationType.none:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A location with type 'none' cannot have geometry",
        )

    geom_type = geometry.get("type") if isinstance(geometry, dict) else None
    allowed = GEOMETRY_TYPES_BY_LOCATION_TYPE.get(location_type, set())
    if geom_type not in allowed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Geometry type '{geom_type}' is not valid for location type "
                f"'{location_type.value}' (expected one of {sorted(allowed)})"
            ),
        )


def _write_geometry(
    db: Session, location_id: int, geometry: Optional[Dict[str, Any]]
) -> None:
    """Set (or clear) the boundary_geometry column for a location.

    Uses ST_GeomFromGeoJSON to convert client GeoJSON into PostGIS. Invalid
    GeoJSON surfaces as HTTP 422 rather than a 500.
    """
    if geometry is None:
        db.execute(
            text("UPDATE location SET boundary_geometry = NULL WHERE id = :id"),
            {"id": location_id},
        )
        return

    try:
        # Store as EWKT text (mirrors how Device.point_geometry is stored): this
        # works whether the column is a real PostGIS geometry (production) or a
        # plain text column (the test schema built from the SQLModel metadata).
        db.execute(
            text(
                "UPDATE location "
                "SET boundary_geometry = ST_AsEWKT(ST_SetSRID(ST_GeomFromGeoJSON(:geojson), 4326)) "
                "WHERE id = :id"
            ),
            {"geojson": json.dumps(geometry), "id": location_id},
        )
        # Force the statement to execute now so malformed GeoJSON fails here.
        db.flush()
    except (DataError, InternalError, ProgrammingError) as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid GeoJSON geometry",
        ) from exc


def _location_read(loc: Location) -> Dict[str, Any]:
    return {"id": loc.id, "name": loc.name, "location_type": loc.location_type}


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=List[LocationRead])
async def get_locations(
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[dict[str, Any]]:
    """Get all locations for the current organisation."""
    locations = db.query(Location).filter(
        Location.organisation_id == org.id
    ).order_by(Location.name).all()

    return [
        {"id": loc.id, "name": loc.name, "location_type": loc.location_type}
        for loc in locations
    ]


@router.get("/by-survey-type/{survey_type_id}", response_model=List[LocationRead])
async def get_locations_by_survey_type(
    survey_type_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[dict[str, Any]]:
    """Get locations available for a specific survey type."""
    result = db.execute(text("""
        SELECT l.id, l.name, l.location_type
        FROM location l
        INNER JOIN survey_type_location stl ON stl.location_id = l.id
        WHERE stl.survey_type_id = :survey_type_id
          AND l.organisation_id = :org_id
        ORDER BY l.name
    """).bindparams(survey_type_id=survey_type_id, org_id=org.id)).fetchall()

    return [{"id": row[0], "name": row[1], "location_type": row[2]} for row in result]


@router.get("/with-boundaries", response_model=List[LocationWithBoundary])
async def get_locations_with_boundaries(
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[dict[str, Any]]:
    """Get all locations that have geometry defined.

    Returns each location's GeoJSON geometry (Polygon/LineString/Point) plus, for
    backward compatibility, the polygon outer ring as [lng, lat] pairs for areas.
    """
    result = db.execute(text("""
        SELECT
            id,
            name,
            location_type,
            ST_AsGeoJSON(boundary_geometry)::json AS geometry,
            CASE
                WHEN GeometryType(boundary_geometry) = 'POLYGON'
                THEN ST_AsGeoJSON(boundary_geometry)::json->'coordinates'->0
            END AS boundary_ring,
            boundary_fill_color,
            boundary_stroke_color,
            boundary_fill_opacity
        FROM location
        WHERE boundary_geometry IS NOT NULL
          AND organisation_id = :org_id
        ORDER BY name
    """).bindparams(org_id=org.id)).fetchall()

    return [{
        "id": row[0],
        "name": row[1],
        "location_type": row[2],
        "geometry": row[3],
        "boundary_geometry": row[4],
        "boundary_fill_color": row[5],
        "boundary_stroke_color": row[6],
        "boundary_fill_opacity": row[7],
    } for row in result]


@router.get("/{location_id}", response_model=LocationRead)
async def get_location(
    location_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Get a specific location by ID"""
    location = db.query(Location).filter(
        Location.id == location_id,
        Location.organisation_id == org.id
    ).first()

    if not location:
        raise HTTPException(status_code=404, detail=f"Location {location_id} not found")

    return _location_read(location)


# ---------------------------------------------------------------------------
# Write endpoints (admin only)
# ---------------------------------------------------------------------------

@router.post("", response_model=LocationRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def create_location(
    location: LocationCreate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Create a new location, optionally with geometry."""
    _validate_geometry(location.location_type, location.geometry)

    db_location = Location(
        name=location.name,
        location_type=location.location_type,
        organisation_id=org.id,
        boundary_fill_color=location.boundary_fill_color,
        boundary_stroke_color=location.boundary_stroke_color,
        boundary_fill_opacity=location.boundary_fill_opacity,
    )
    db.add(db_location)
    db.flush()  # assign id before writing geometry
    assert db_location.id is not None  # populated by flush

    if location.geometry is not None:
        _write_geometry(db, db_location.id, location.geometry)

    db.commit()
    db.refresh(db_location)

    return _location_read(db_location)


@router.put("/{location_id}", response_model=LocationRead, dependencies=[Depends(require_admin)])
async def update_location(
    location_id: int,
    location: LocationUpdate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Update an existing location.

    Geometry is only touched when the ``geometry`` key is present in the request
    body: an explicit ``null`` clears it, an omitted key leaves it unchanged.
    Setting ``location_type`` to ``none`` always clears any geometry.
    """
    db_location = db.query(Location).filter(
        Location.id == location_id,
        Location.organisation_id == org.id
    ).first()

    if not db_location:
        raise HTTPException(status_code=404, detail=f"Location {location_id} not found")

    fields_set = location.model_fields_set
    type_changed = (
        "location_type" in fields_set
        and location.location_type is not None
        and location.location_type != db_location.location_type
    )

    if location.name is not None:
        db_location.name = location.name
    if "location_type" in fields_set and location.location_type is not None:
        db_location.location_type = location.location_type
    if "boundary_fill_color" in fields_set:
        db_location.boundary_fill_color = location.boundary_fill_color
    if "boundary_stroke_color" in fields_set:
        db_location.boundary_stroke_color = location.boundary_stroke_color
    if "boundary_fill_opacity" in fields_set:
        db_location.boundary_fill_opacity = location.boundary_fill_opacity

    # Determine the effective type for geometry validation.
    effective_type = db_location.location_type

    if effective_type == LocationType.none:
        # A no-GPS location can never carry geometry.
        db.flush()
        _write_geometry(db, location_id, None)
    elif "geometry" in fields_set:
        _validate_geometry(effective_type, location.geometry)
        db.flush()
        _write_geometry(db, location_id, location.geometry)
    elif type_changed:
        # Type changed to a different shape without new geometry: the old
        # shape can't match the new type, so drop it.
        db.flush()
        _write_geometry(db, location_id, None)

    db.commit()
    db.refresh(db_location)

    return _location_read(db_location)


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_location(
    location_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> None:
    """Delete a location"""
    db_location = db.query(Location).filter(
        Location.id == location_id,
        Location.organisation_id == org.id
    ).first()

    if not db_location:
        raise HTTPException(status_code=404, detail=f"Location {location_id} not found")

    db.delete(db_location)
    db.commit()
    return None
