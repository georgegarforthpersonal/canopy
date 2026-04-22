"""
Devices Router - API endpoints for audio recorder device management

Endpoints:
  GET    /api/devices                        - List all devices
  GET    /api/devices/{id}                   - Get specific device
  GET    /api/devices/by-device-id/{device_id} - Lookup by serial number
  POST   /api/devices                        - Create new device
  PUT    /api/devices/{id}                   - Update device
  DELETE /api/devices/{id}                   - Delete device
  POST   /api/devices/{id}/deactivate        - Deactivate device
  POST   /api/devices/{id}/reactivate        - Reactivate device
"""

from fastapi import APIRouter, HTTPException, status, Depends, Query
from typing import List, Optional, Any
from sqlalchemy.orm import Session
from sqlalchemy import text
from database.connection import get_db
from models import Device, DeviceRead, DeviceCreate, DeviceUpdate, Organisation, Location
from auth import require_admin
from dependencies import get_current_organisation

router = APIRouter()


def _check_device_duplicate(
    db: Session,
    device_id: str,
    org_id: int,
    exclude_id: Optional[int] = None
) -> None:
    """
    Check if a device with the same device_id already exists in this organisation.
    Raises HTTPException with 409 Conflict if duplicate found.
    """
    query = db.query(Device).filter(
        Device.organisation_id == org_id,
        Device.device_id == device_id
    )

    if exclude_id is not None:
        query = query.filter(Device.id != exclude_id)

    existing = query.first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A device with ID '{device_id}' already exists"
        )


def _device_to_read(row: Any) -> DeviceRead:
    """Convert a database row to DeviceRead model"""
    return DeviceRead(
        id=row.id,
        device_id=row.device_id,
        name=row.name,
        device_type=row.device_type,
        latitude=row.latitude,
        longitude=row.longitude,
        location_id=row.location_id,
        location_name=row.location_name,
        is_active=row.is_active
    )


@router.get("", response_model=List[DeviceRead])
async def get_devices(
    include_inactive: bool = False,
    device_type: Optional[str] = Query(None, description="Filter by device type (audio_recorder, camera_trap)"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[DeviceRead]:
    """
    Get all devices for the current organisation.

    Args:
        include_inactive: If True, include inactive devices. Default: False (only active)
        device_type: Optional filter by device type

    Returns:
        List of devices with location info
    """
    # Build WHERE clause conditions
    where_conditions = ["d.organisation_id = :org_id"]
    params: dict[str, Any] = {"org_id": org.id}

    if not include_inactive:
        where_conditions.append("d.is_active = true")

    if device_type:
        where_conditions.append("d.device_type = :device_type")
        params["device_type"] = device_type

    where_clause = " AND ".join(where_conditions)

    # Use raw SQL to extract lat/lng from PostGIS point
    query = text(f"""
        SELECT
            d.id,
            d.device_id,
            d.name,
            d.device_type,
            d.location_id,
            d.is_active,
            ST_Y(d.point_geometry) as latitude,
            ST_X(d.point_geometry) as longitude,
            l.name as location_name
        FROM device d
        LEFT JOIN location l ON d.location_id = l.id
        WHERE {where_clause}
        ORDER BY d.device_id
    """)

    result = db.execute(query, params)
    rows = result.fetchall()

    return [_device_to_read(row) for row in rows]


@router.get("/by-device-id/{device_id}", response_model=DeviceRead)
async def get_device_by_device_id(
    device_id: str,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> DeviceRead:
    """
    Look up a device by its serial number (device_id field).

    This is used when processing audio/image files to find the device
    based on the serial number extracted from the filename.
    """
    query = text("""
        SELECT
            d.id,
            d.device_id,
            d.name,
            d.device_type,
            d.location_id,
            d.is_active,
            ST_Y(d.point_geometry) as latitude,
            ST_X(d.point_geometry) as longitude,
            l.name as location_name
        FROM device d
        LEFT JOIN location l ON d.location_id = l.id
        WHERE d.organisation_id = :org_id
        AND d.device_id = :device_id
    """)

    result = db.execute(query, {"org_id": org.id, "device_id": device_id})
    row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Device with ID '{device_id}' not found")

    return _device_to_read(row)


@router.get("/{id}", response_model=DeviceRead)
async def get_device(
    id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> DeviceRead:
    """Get a specific device by ID"""
    query = text("""
        SELECT
            d.id,
            d.device_id,
            d.name,
            d.device_type,
            d.location_id,
            d.is_active,
            ST_Y(d.point_geometry) as latitude,
            ST_X(d.point_geometry) as longitude,
            l.name as location_name
        FROM device d
        LEFT JOIN location l ON d.location_id = l.id
        WHERE d.id = :id
        AND d.organisation_id = :org_id
    """)

    result = db.execute(query, {"id": id, "org_id": org.id})
    row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Device {id} not found")

    return _device_to_read(row)


@router.post("", response_model=DeviceRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def create_device(
    device: DeviceCreate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> DeviceRead:
    """Create a new device"""
    # Check for duplicate device_id within this organisation
    assert org.id is not None  # guaranteed by get_current_organisation
    _check_device_duplicate(db, device.device_id, org.id)

    # Validate location_id belongs to this organisation
    if device.location_id is not None:
        location = db.query(Location).filter(
            Location.id == device.location_id,
            Location.organisation_id == org.id
        ).first()
        if not location:
            raise HTTPException(status_code=400, detail=f"Location {device.location_id} not found")

    # Create the device with coordinates set atomically (point_geometry is NOT NULL).
    db_device = Device(
        device_id=device.device_id,
        name=device.name,
        device_type=device.device_type,
        location_id=device.location_id,
        organisation_id=org.id,
        point_geometry=f"SRID=4326;POINT({device.longitude} {device.latitude})",
    )
    db.add(db_device)
    db.commit()
    db.refresh(db_device)

    # Fetch and return the created device with all fields
    return await get_device(db_device.id, org, db)  # type: ignore[no-any-return]


@router.put("/{id}", response_model=DeviceRead, dependencies=[Depends(require_admin)])
async def update_device(
    id: int,
    device: DeviceUpdate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> DeviceRead:
    """Update an existing device"""
    db_device = db.query(Device).filter(
        Device.id == id,
        Device.organisation_id == org.id
    ).first()
    if not db_device:
        raise HTTPException(status_code=404, detail=f"Device {id} not found")

    update_data = device.model_dump(exclude_unset=True)

    # Check for duplicate device_id if being changed
    if 'device_id' in update_data:
        assert org.id is not None  # guaranteed by get_current_organisation
        _check_device_duplicate(db, update_data['device_id'], org.id, exclude_id=id)

    # Validate location_id if being changed
    if 'location_id' in update_data and update_data['location_id'] is not None:
        location = db.query(Location).filter(
            Location.id == update_data['location_id'],
            Location.organisation_id == org.id
        ).first()
        if not location:
            raise HTTPException(status_code=400, detail=f"Location {update_data['location_id']} not found")

    # Handle coordinate updates
    lat = update_data.pop('latitude', None)
    lng = update_data.pop('longitude', None)

    # Update regular fields
    for field, value in update_data.items():
        setattr(db_device, field, value)

    db.commit()

    # Update point geometry if coordinates provided
    if lat is not None and lng is not None:
        db.execute(
            text("""
                UPDATE device
                SET point_geometry = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)
                WHERE id = :id
            """),
            {"lng": lng, "lat": lat, "id": id}
        )
        db.commit()

    # Fetch and return the updated device
    return await get_device(id, org, db)  # type: ignore[no-any-return]


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_device(
    id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> None:
    """Delete a device (hard delete - use deactivate instead for soft delete)"""
    db_device = db.query(Device).filter(
        Device.id == id,
        Device.organisation_id == org.id
    ).first()
    if not db_device:
        raise HTTPException(status_code=404, detail=f"Device {id} not found")

    db.delete(db_device)
    db.commit()
    return None


@router.post("/{id}/deactivate", response_model=DeviceRead, dependencies=[Depends(require_admin)])
async def deactivate_device(
    id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> DeviceRead:
    """
    Deactivate a device (soft delete).

    The device will no longer appear in active device lists,
    but historical data referencing this device is preserved.
    """
    db_device = db.query(Device).filter(
        Device.id == id,
        Device.organisation_id == org.id
    ).first()
    if not db_device:
        raise HTTPException(status_code=404, detail=f"Device {id} not found")

    if not db_device.is_active:
        raise HTTPException(status_code=400, detail=f"Device {id} is already inactive")

    db_device.is_active = False
    db.commit()

    return await get_device(id, org, db)  # type: ignore[no-any-return]


@router.post("/{id}/reactivate", response_model=DeviceRead, dependencies=[Depends(require_admin)])
async def reactivate_device(
    id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> DeviceRead:
    """
    Reactivate a previously deactivated device.

    The device will appear in active device lists again.
    """
    db_device = db.query(Device).filter(
        Device.id == id,
        Device.organisation_id == org.id
    ).first()
    if not db_device:
        raise HTTPException(status_code=404, detail=f"Device {id} not found")

    if db_device.is_active:
        raise HTTPException(status_code=400, detail=f"Device {id} is already active")

    db_device.is_active = True
    db.commit()

    return await get_device(id, org, db)  # type: ignore[no-any-return]
