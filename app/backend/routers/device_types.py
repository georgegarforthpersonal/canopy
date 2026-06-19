"""
Device Types Router - API endpoints for the device type registry.

Device types are split into:
  - built-in *system* types (organisation_id NULL, is_system True) shared by every
    organisation; these have processing behaviour wired to their slug in code and
    cannot be modified or deleted.
  - per-organisation *custom* types created by admins; these are passive (map marker
    + sighting target only) and carry just a display name, icon and colour.

Endpoints:
  GET    /api/device-types                 - List system + this org's types
  POST   /api/device-types                 - Create a custom type
  PUT    /api/device-types/{id}            - Update a custom type
  POST   /api/device-types/{id}/deactivate - Deactivate a custom type
  POST   /api/device-types/{id}/reactivate - Reactivate a custom type
  DELETE /api/device-types/{id}            - Delete an unused custom type
"""

import re
from fastapi import APIRouter, HTTPException, status, Depends, Query
from typing import List, Optional
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database.connection import get_db
from models import (
    DeviceTypeRegistry, DeviceTypeRead, DeviceTypeCreate, DeviceTypeUpdate,
    Device, SurveyType, Organisation,
)
from auth import require_admin
from dependencies import get_current_organisation

router = APIRouter()


def slugify(value: str) -> str:
    """Convert a display name to a machine-readable slug (a-z0-9_, max 50 chars)."""
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return slug[:50]


def validate_device_type_slug(db: Session, org_id: int, slug: str) -> None:
    """Ensure ``slug`` is an active device type available to this organisation.

    Valid when it is an active system type (organisation_id NULL) or an active
    type owned by this organisation. Raises HTTP 400 otherwise.

    Importable by other routers (devices, survey_types) so device type references
    stay consistent across the API.
    """
    exists = (
        db.query(DeviceTypeRegistry.id)
        .filter(
            DeviceTypeRegistry.slug == slug,
            DeviceTypeRegistry.is_active == True,  # noqa: E712
            or_(
                DeviceTypeRegistry.organisation_id.is_(None),
                DeviceTypeRegistry.organisation_id == org_id,
            ),
        )
        .first()
    )
    if not exists:
        raise HTTPException(status_code=400, detail=f"Unknown or inactive device type '{slug}'")


def _get_owned_type(db: Session, id: int, org_id: int) -> DeviceTypeRegistry:
    """Fetch a device type by id, scoped to rows this org may mutate.

    404 if not found for the org; 403 if it is a protected system type.
    """
    row = (
        db.query(DeviceTypeRegistry)
        .filter(
            DeviceTypeRegistry.id == id,
            or_(
                DeviceTypeRegistry.organisation_id.is_(None),
                DeviceTypeRegistry.organisation_id == org_id,
            ),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"Device type {id} not found")
    if row.is_system:
        raise HTTPException(status_code=403, detail="System device types cannot be modified")
    return row


@router.get("", response_model=List[DeviceTypeRead])
async def get_device_types(
    include_inactive: bool = Query(False, description="Include this org's inactive custom types"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> List[DeviceTypeRegistry]:
    """List the device types available to the current organisation (system + custom)."""
    query = db.query(DeviceTypeRegistry).filter(
        or_(
            DeviceTypeRegistry.organisation_id.is_(None),
            DeviceTypeRegistry.organisation_id == org.id,
        )
    )
    if not include_inactive:
        query = query.filter(DeviceTypeRegistry.is_active == True)  # noqa: E712

    # System types first, then alphabetical by display name.
    rows = query.order_by(
        DeviceTypeRegistry.is_system.desc(),
        DeviceTypeRegistry.display_name,
    ).all()
    return rows  # type: ignore[no-any-return]


@router.post("", response_model=DeviceTypeRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def create_device_type(
    device_type: DeviceTypeCreate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> DeviceTypeRegistry:
    """Create a custom device type for the current organisation."""
    slug = slugify(device_type.display_name)
    if not slug:
        raise HTTPException(status_code=400, detail="Display name must contain at least one alphanumeric character")

    # Reject collisions with a system slug or an existing slug for this org.
    clash = (
        db.query(DeviceTypeRegistry.id)
        .filter(
            DeviceTypeRegistry.slug == slug,
            or_(
                DeviceTypeRegistry.organisation_id.is_(None),
                DeviceTypeRegistry.organisation_id == org.id,
            ),
        )
        .first()
    )
    if clash:
        raise HTTPException(status_code=409, detail=f"A device type matching '{slug}' already exists")

    db_type = DeviceTypeRegistry(
        slug=slug,
        display_name=device_type.display_name,
        icon_key=device_type.icon_key,
        color=device_type.color,
        organisation_id=org.id,
        is_system=False,
        is_active=True,
    )
    db.add(db_type)
    db.commit()
    db.refresh(db_type)
    return db_type


@router.put("/{id}", response_model=DeviceTypeRead, dependencies=[Depends(require_admin)])
async def update_device_type(
    id: int,
    device_type: DeviceTypeUpdate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> DeviceTypeRegistry:
    """Update a custom device type (slug is immutable)."""
    assert org.id is not None
    db_type = _get_owned_type(db, id, org.id)

    update_data = device_type.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_type, field, value)

    db.commit()
    db.refresh(db_type)
    return db_type


@router.post("/{id}/deactivate", response_model=DeviceTypeRead, dependencies=[Depends(require_admin)])
async def deactivate_device_type(
    id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> DeviceTypeRegistry:
    """Deactivate a custom device type (existing devices keep their slug)."""
    assert org.id is not None
    db_type = _get_owned_type(db, id, org.id)
    if not db_type.is_active:
        raise HTTPException(status_code=400, detail=f"Device type {id} is already inactive")
    db_type.is_active = False
    db.commit()
    db.refresh(db_type)
    return db_type


@router.post("/{id}/reactivate", response_model=DeviceTypeRead, dependencies=[Depends(require_admin)])
async def reactivate_device_type(
    id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> DeviceTypeRegistry:
    """Reactivate a previously deactivated custom device type."""
    assert org.id is not None
    db_type = _get_owned_type(db, id, org.id)
    if db_type.is_active:
        raise HTTPException(status_code=400, detail=f"Device type {id} is already active")
    db_type.is_active = True
    db.commit()
    db.refresh(db_type)
    return db_type


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_device_type(
    id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> None:
    """Hard-delete an unused custom device type.

    Blocked (409) if any device uses the slug or any survey type references it;
    deactivate instead to preserve historical references.
    """
    assert org.id is not None
    db_type = _get_owned_type(db, id, org.id)

    device_count = (
        db.query(Device.id)
        .filter(Device.organisation_id == org.id, Device.device_type == db_type.slug)
        .count()
    )
    survey_type_count = (
        db.query(SurveyType.id)
        .filter(SurveyType.organisation_id == org.id, SurveyType.sighting_device_type == db_type.slug)
        .count()
    )
    if device_count or survey_type_count:
        raise HTTPException(
            status_code=409,
            detail="Device type is in use; deactivate it instead of deleting",
        )

    db.delete(db_type)
    db.commit()
    return None
