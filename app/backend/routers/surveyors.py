"""
Surveyors Router - API endpoints for surveyor management

Endpoints:
  GET    /api/surveyors            - List all surveyors
  POST   /api/surveyors            - Create new surveyor
  GET    /api/surveyors/{id}       - Get specific surveyor
  PUT    /api/surveyors/{id}       - Update surveyor
  DELETE /api/surveyors/{id}       - Delete surveyor

Refactored to use SQLModel ORM instead of raw SQL.
"""

from fastapi import APIRouter, HTTPException, status, Depends
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from database.connection import get_db
from models import Surveyor, SurveyorRead, SurveyorCreate, SurveyorUpdate, Organisation
from auth import require_admin_role, require_editor
from dependencies import get_current_organisation

router = APIRouter()


def _check_surveyor_duplicate(
    db: Session,
    first_name: str,
    last_name: Optional[str],
    org_id: int,
    exclude_id: Optional[int] = None
) -> None:
    """
    Check if a surveyor with the same name already exists in this organisation.
    Raises HTTPException with 409 Conflict if duplicate found.

    Uses case-insensitive comparison and treats NULL/empty last_name as equivalent.
    """
    # Normalize: treat empty string as None for comparison
    normalized_last = last_name.strip() if last_name else None
    if normalized_last == '':
        normalized_last = None

    query = db.query(Surveyor).filter(
        Surveyor.organisation_id == org_id,
        func.lower(Surveyor.first_name) == first_name.lower(),
        func.lower(func.coalesce(Surveyor.last_name, '')) == (normalized_last or '').lower()
    )

    if exclude_id is not None:
        query = query.filter(Surveyor.id != exclude_id)

    existing = query.first()
    if existing:
        full_name = f"{first_name} {last_name}".strip() if last_name else first_name
        raise HTTPException(
            status_code=409,
            detail=f"A surveyor named '{full_name}' already exists"
        )


@router.get("", response_model=List[SurveyorRead])
async def get_surveyors(
    include_inactive: bool = False,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[Surveyor]:
    """
    Get all surveyors for the current organisation.

    Args:
        include_inactive: If True, include inactive surveyors. Default: False (only active)

    Returns:
        List of surveyors ordered by last name, first name
    """
    query = db.query(Surveyor).filter(Surveyor.organisation_id == org.id)

    if not include_inactive:
        query = query.filter(Surveyor.is_active == True)

    # Sort by last_name (NULLs last), then first_name
    surveyors = query.order_by(
        func.coalesce(Surveyor.last_name, 'ZZZZZ'),
        Surveyor.first_name
    ).all()
    return surveyors  # type: ignore[no-any-return]


@router.get("/{surveyor_id}", response_model=SurveyorRead)
async def get_surveyor(
    surveyor_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> Surveyor:
    """Get a specific surveyor by ID"""
    surveyor = db.query(Surveyor).filter(
        Surveyor.id == surveyor_id,
        Surveyor.organisation_id == org.id
    ).first()
    if not surveyor:
        raise HTTPException(status_code=404, detail=f"Surveyor {surveyor_id} not found")
    return surveyor  # type: ignore[no-any-return]


@router.post("", response_model=SurveyorRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_editor)])
async def create_surveyor(
    surveyor: SurveyorCreate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> Surveyor:
    """Create a new surveyor"""
    # Check for duplicate name within this organisation
    assert org.id is not None  # guaranteed by get_current_organisation
    _check_surveyor_duplicate(db, surveyor.first_name, surveyor.last_name, org.id)

    db_surveyor = Surveyor(
        first_name=surveyor.first_name,
        last_name=surveyor.last_name,
        organisation_id=org.id
    )
    db.add(db_surveyor)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        full_name = f"{surveyor.first_name} {surveyor.last_name}".strip() if surveyor.last_name else surveyor.first_name
        raise HTTPException(
            status_code=409,
            detail=f"A surveyor named '{full_name}' already exists"
        )
    db.refresh(db_surveyor)
    return db_surveyor


@router.put("/{surveyor_id}", response_model=SurveyorRead, dependencies=[Depends(require_editor)])
async def update_surveyor(
    surveyor_id: int,
    surveyor: SurveyorUpdate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> Surveyor:
    """Update an existing surveyor"""
    db_surveyor = db.query(Surveyor).filter(
        Surveyor.id == surveyor_id,
        Surveyor.organisation_id == org.id
    ).first()
    if not db_surveyor:
        raise HTTPException(status_code=404, detail=f"Surveyor {surveyor_id} not found")

    # Determine final name values for duplicate check
    update_data = surveyor.model_dump(exclude_unset=True)
    final_first_name = update_data.get('first_name', db_surveyor.first_name)
    final_last_name = update_data.get('last_name', db_surveyor.last_name)

    # Check for duplicate (excluding current surveyor)
    assert org.id is not None  # guaranteed by get_current_organisation
    _check_surveyor_duplicate(db, final_first_name, final_last_name, org.id, exclude_id=surveyor_id)

    # Update only the fields that were provided
    for field, value in update_data.items():
        setattr(db_surveyor, field, value)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        full_name = f"{final_first_name} {final_last_name}".strip() if final_last_name else final_first_name
        raise HTTPException(
            status_code=409,
            detail=f"A surveyor named '{full_name}' already exists"
        )
    db.refresh(db_surveyor)
    return db_surveyor  # type: ignore[no-any-return]


@router.delete("/{surveyor_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin_role)])
async def delete_surveyor(
    surveyor_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> None:
    """Delete a surveyor (hard delete - use deactivate instead for soft delete)"""
    db_surveyor = db.query(Surveyor).filter(
        Surveyor.id == surveyor_id,
        Surveyor.organisation_id == org.id
    ).first()
    if not db_surveyor:
        raise HTTPException(status_code=404, detail=f"Surveyor {surveyor_id} not found")

    db.delete(db_surveyor)
    db.commit()
    return None


@router.post("/{surveyor_id}/deactivate", response_model=SurveyorRead, dependencies=[Depends(require_admin_role)])
async def deactivate_surveyor(
    surveyor_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> Surveyor:
    """
    Deactivate a surveyor (soft delete).

    The surveyor will no longer appear in active surveyor lists,
    but their historical survey data is preserved.
    """
    db_surveyor = db.query(Surveyor).filter(
        Surveyor.id == surveyor_id,
        Surveyor.organisation_id == org.id
    ).first()
    if not db_surveyor:
        raise HTTPException(status_code=404, detail=f"Surveyor {surveyor_id} not found")

    if not db_surveyor.is_active:
        raise HTTPException(status_code=400, detail=f"Surveyor {surveyor_id} is already inactive")

    db_surveyor.is_active = False
    db.commit()
    db.refresh(db_surveyor)
    return db_surveyor  # type: ignore[no-any-return]


@router.post("/{surveyor_id}/reactivate", response_model=SurveyorRead, dependencies=[Depends(require_admin_role)])
async def reactivate_surveyor(
    surveyor_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> Surveyor:
    """
    Reactivate a previously deactivated surveyor.

    The surveyor will appear in active surveyor lists again.
    """
    db_surveyor = db.query(Surveyor).filter(
        Surveyor.id == surveyor_id,
        Surveyor.organisation_id == org.id
    ).first()
    if not db_surveyor:
        raise HTTPException(status_code=404, detail=f"Surveyor {surveyor_id} not found")

    if db_surveyor.is_active:
        raise HTTPException(status_code=400, detail=f"Surveyor {surveyor_id} is already active")

    db_surveyor.is_active = True
    db.commit()
    db.refresh(db_surveyor)
    return db_surveyor  # type: ignore[no-any-return]
