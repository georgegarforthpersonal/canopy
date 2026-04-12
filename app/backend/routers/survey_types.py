"""
Survey Types Router - API endpoints for survey type configuration management

Endpoints:
  GET    /api/survey-types                    - List all survey types
  POST   /api/survey-types                    - Create new survey type
  GET    /api/survey-types/{id}               - Get specific survey type with details
  PUT    /api/survey-types/{id}               - Update survey type
  DELETE /api/survey-types/{id}               - Delete (deactivate) survey type
  GET    /api/survey-types/species-types      - List all species types
"""

from fastapi import APIRouter, HTTPException, status, Depends
from typing import List
from sqlalchemy.orm import Session
from database.connection import get_db
from auth import require_admin
from dependencies import get_current_organisation
from models import (
    SurveyType, SurveyTypeRead, SurveyTypeCreate, SurveyTypeUpdate, SurveyTypeWithDetails,
    SurveyTypeLocationLink, SurveyTypeSpeciesTypeLink,
    SpeciesType, SpeciesTypeRead,
    Location, LocationRead,
    Organisation
)

router = APIRouter()


@router.get("/species-types", response_model=List[SpeciesTypeRead])
async def get_species_types(db: Session = Depends(get_db)) -> List[SpeciesType]:
    """Get all species types (reference data - global, not org-specific)"""
    species_types = db.query(SpeciesType).order_by(SpeciesType.display_name).all()
    return species_types  # type: ignore[no-any-return]


@router.get("", response_model=List[SurveyTypeRead])
async def get_survey_types(
    include_inactive: bool = False,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[SurveyType]:
    """
    Get all survey types for the current organisation.

    Args:
        include_inactive: If True, include inactive survey types. Default: False

    Returns:
        List of survey types ordered by name
    """
    query = db.query(SurveyType).filter(SurveyType.organisation_id == org.id)

    if not include_inactive:
        query = query.filter(SurveyType.is_active == True)

    survey_types = query.order_by(SurveyType.name).all()
    return survey_types  # type: ignore[no-any-return]


@router.get("/{survey_type_id}", response_model=SurveyTypeWithDetails)
async def get_survey_type(
    survey_type_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> SurveyTypeWithDetails:
    """Get a specific survey type with full details including locations and species types"""
    survey_type = db.query(SurveyType).filter(
        SurveyType.id == survey_type_id,
        SurveyType.organisation_id == org.id
    ).first()
    if not survey_type:
        raise HTTPException(status_code=404, detail=f"Survey type {survey_type_id} not found")

    # Get associated locations (filter by org as well for safety)
    locations = (
        db.query(Location)
        .join(SurveyTypeLocationLink, SurveyTypeLocationLink.location_id == Location.id)
        .filter(
            SurveyTypeLocationLink.survey_type_id == survey_type_id,
            Location.organisation_id == org.id
        )
        .order_by(Location.name)
        .all()
    )

    # Get associated species types (global data, no org filter)
    species_types = (
        db.query(SpeciesType)
        .join(SurveyTypeSpeciesTypeLink, SurveyTypeSpeciesTypeLink.species_type_id == SpeciesType.id)
        .filter(SurveyTypeSpeciesTypeLink.survey_type_id == survey_type_id)
        .order_by(SpeciesType.display_name)
        .all()
    )

    # Build response
    return SurveyTypeWithDetails(
        id=survey_type.id,
        name=survey_type.name,
        description=survey_type.description,
        location_at_sighting_level=survey_type.location_at_sighting_level,
        allow_geolocation=survey_type.allow_geolocation,
        allow_sighting_notes=survey_type.allow_sighting_notes,
        allow_audio_upload=survey_type.allow_audio_upload,
        allow_image_upload=survey_type.allow_image_upload,
        allow_start_end_time=survey_type.allow_start_end_time,
        allow_sun_percentage=survey_type.allow_sun_percentage,
        allow_temperature=survey_type.allow_temperature,
        allow_show_description=survey_type.allow_show_description,
        icon=survey_type.icon,
        color=survey_type.color,
        is_active=survey_type.is_active,
        locations=[LocationRead.model_validate(loc) for loc in locations],
        species_types=[SpeciesTypeRead.model_validate(st) for st in species_types]
    )


@router.post("", response_model=SurveyTypeRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def create_survey_type(
    survey_type: SurveyTypeCreate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> SurveyType:
    """Create a new survey type with associated locations and species types"""
    # Check for duplicate name within this organisation
    existing = db.query(SurveyType).filter(
        SurveyType.name == survey_type.name,
        SurveyType.organisation_id == org.id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Survey type '{survey_type.name}' already exists")

    # Validate location IDs (must belong to this org)
    if survey_type.location_ids:
        existing_locations = db.query(Location.id).filter(
            Location.id.in_(survey_type.location_ids),  # type: ignore[union-attr]
            Location.organisation_id == org.id
        ).all()
        existing_location_ids = {loc.id for loc in existing_locations}
        invalid_ids = set(survey_type.location_ids) - existing_location_ids
        if invalid_ids:
            raise HTTPException(status_code=400, detail=f"Invalid location IDs: {invalid_ids}")

    # Validate species type IDs (global data)
    if survey_type.species_type_ids:
        existing_species_types = db.query(SpeciesType.id).filter(SpeciesType.id.in_(survey_type.species_type_ids)).all()  # type: ignore[union-attr]
        existing_st_ids = {st.id for st in existing_species_types}
        invalid_ids = set(survey_type.species_type_ids) - existing_st_ids
        if invalid_ids:
            raise HTTPException(status_code=400, detail=f"Invalid species type IDs: {invalid_ids}")

    # Create survey type
    db_survey_type = SurveyType(
        name=survey_type.name,
        description=survey_type.description,
        location_at_sighting_level=survey_type.location_at_sighting_level,
        allow_geolocation=survey_type.allow_geolocation,
        allow_sighting_notes=survey_type.allow_sighting_notes,
        allow_audio_upload=survey_type.allow_audio_upload,
        allow_image_upload=survey_type.allow_image_upload,
        icon=survey_type.icon,
        color=survey_type.color,
        organisation_id=org.id
    )
    db.add(db_survey_type)
    db.flush()  # Get the ID

    # Add location links
    for location_id in survey_type.location_ids:
        link = SurveyTypeLocationLink(survey_type_id=db_survey_type.id, location_id=location_id)
        db.add(link)

    # Add species type links
    for species_type_id in survey_type.species_type_ids:
        link = SurveyTypeSpeciesTypeLink(survey_type_id=db_survey_type.id, species_type_id=species_type_id)
        db.add(link)

    db.commit()
    db.refresh(db_survey_type)
    return db_survey_type


@router.put("/{survey_type_id}", response_model=SurveyTypeRead, dependencies=[Depends(require_admin)])
async def update_survey_type(
    survey_type_id: int,
    survey_type: SurveyTypeUpdate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> SurveyType:
    """Update an existing survey type"""
    db_survey_type = db.query(SurveyType).filter(
        SurveyType.id == survey_type_id,
        SurveyType.organisation_id == org.id
    ).first()
    if not db_survey_type:
        raise HTTPException(status_code=404, detail=f"Survey type {survey_type_id} not found")

    # Check for duplicate name if name is being changed
    if survey_type.name and survey_type.name != db_survey_type.name:
        existing = db.query(SurveyType).filter(
            SurveyType.name == survey_type.name,
            SurveyType.organisation_id == org.id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Survey type '{survey_type.name}' already exists")

    # Update basic fields
    update_data = survey_type.model_dump(exclude_unset=True, exclude={'location_ids', 'species_type_ids'})
    for field, value in update_data.items():
        setattr(db_survey_type, field, value)

    # Update location links if provided
    if survey_type.location_ids is not None:
        # Validate location IDs (must belong to this org)
        if survey_type.location_ids:
            existing_locations = db.query(Location.id).filter(
                Location.id.in_(survey_type.location_ids),  # type: ignore[union-attr]
                Location.organisation_id == org.id
            ).all()
            existing_location_ids = {loc.id for loc in existing_locations}
            invalid_ids = set(survey_type.location_ids) - existing_location_ids
            if invalid_ids:
                raise HTTPException(status_code=400, detail=f"Invalid location IDs: {invalid_ids}")

        # Delete existing links
        db.query(SurveyTypeLocationLink).filter(SurveyTypeLocationLink.survey_type_id == survey_type_id).delete()

        # Add new links
        for location_id in survey_type.location_ids:
            link = SurveyTypeLocationLink(survey_type_id=survey_type_id, location_id=location_id)
            db.add(link)

    # Update species type links if provided
    if survey_type.species_type_ids is not None:
        # Validate species type IDs
        if survey_type.species_type_ids:
            existing_species_types = db.query(SpeciesType.id).filter(SpeciesType.id.in_(survey_type.species_type_ids)).all()  # type: ignore[union-attr]
            existing_st_ids = {st.id for st in existing_species_types}
            invalid_ids = set(survey_type.species_type_ids) - existing_st_ids
            if invalid_ids:
                raise HTTPException(status_code=400, detail=f"Invalid species type IDs: {invalid_ids}")

        # Delete existing links
        db.query(SurveyTypeSpeciesTypeLink).filter(SurveyTypeSpeciesTypeLink.survey_type_id == survey_type_id).delete()

        # Add new links
        for species_type_id in survey_type.species_type_ids:
            link = SurveyTypeSpeciesTypeLink(survey_type_id=survey_type_id, species_type_id=species_type_id)
            db.add(link)

    db.commit()
    db.refresh(db_survey_type)
    return db_survey_type  # type: ignore[no-any-return]


@router.delete("/{survey_type_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_survey_type(
    survey_type_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> None:
    """
    Soft delete (deactivate) a survey type.

    The survey type will no longer appear in active lists,
    but surveys using this type are preserved.
    """
    db_survey_type = db.query(SurveyType).filter(
        SurveyType.id == survey_type_id,
        SurveyType.organisation_id == org.id
    ).first()
    if not db_survey_type:
        raise HTTPException(status_code=404, detail=f"Survey type {survey_type_id} not found")

    db_survey_type.is_active = False
    db.commit()
    return None


@router.post("/{survey_type_id}/reactivate", response_model=SurveyTypeRead, dependencies=[Depends(require_admin)])
async def reactivate_survey_type(
    survey_type_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> SurveyType:
    """Reactivate a deactivated survey type"""
    db_survey_type = db.query(SurveyType).filter(
        SurveyType.id == survey_type_id,
        SurveyType.organisation_id == org.id
    ).first()
    if not db_survey_type:
        raise HTTPException(status_code=404, detail=f"Survey type {survey_type_id} not found")

    db_survey_type.is_active = True
    db.commit()
    db.refresh(db_survey_type)
    return db_survey_type  # type: ignore[no-any-return]
