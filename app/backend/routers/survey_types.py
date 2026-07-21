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

from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File
from typing import List, Set, Union
from sqlmodel import col
from sqlalchemy import func
from sqlalchemy.orm import Session
from database.connection import get_db
from auth import require_admin_role
from dependencies import get_current_organisation
from models import (
    SurveyType, SurveyTypeRead, SurveyTypeCreate, SurveyTypeUpdate, SurveyTypeWithDetails,
    SurveyTypeLocationLink, SurveyTypeSpeciesTypeLink, SurveyTypeSpeciesLink,
    SurveyTypeFile, SurveyTypeFileRead,
    Species, SpeciesType, SpeciesTypeRead,
    Location, LocationRead,
    Organisation
)
from routers.species import _to_species_read
from services.r2_storage import (
    MediaType,
    upload_media_file,
    delete_media_file,
    generate_media_presigned_url,
)

router = APIRouter()

# Maximum reference file size: 25 MB
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024


def _get_owned_survey_type(survey_type_id: int, org: Organisation, db: Session) -> SurveyType:
    """Fetch a survey type that belongs to the org, or raise 404."""
    survey_type = db.query(SurveyType).filter(
        SurveyType.id == survey_type_id,
        SurveyType.organisation_id == org.id,
    ).first()
    if not survey_type:
        raise HTTPException(status_code=404, detail=f"Survey type {survey_type_id} not found")
    return survey_type  # type: ignore[no-any-return]


def _validate_sighting_device_selection(payload: Union[SurveyType, SurveyTypeCreate]) -> None:
    """Validate that sighting device selection config is internally consistent.

    - When enabled, sighting_device_type must be set.
    - When enabled, location_at_sighting_level and allow_geolocation must be False
      (the device supplies location for each sighting).
    """
    if not payload.allow_sighting_device_selection:
        return
    if not payload.sighting_device_type:
        raise HTTPException(
            status_code=400,
            detail="sighting_device_type is required when allow_sighting_device_selection is enabled"
        )
    if payload.location_at_sighting_level:
        raise HTTPException(
            status_code=400,
            detail="location_at_sighting_level must be disabled when using sighting device selection"
        )
    if payload.allow_geolocation:
        raise HTTPException(
            status_code=400,
            detail="allow_geolocation must be disabled when using sighting device selection"
        )


def _validate_species_ids(species_ids: List[int], species_type_ids: Set[int], db: Session) -> None:
    """Explicit species must exist and belong to the survey type's species types."""
    if not species_ids:
        return
    rows = db.query(Species.id, Species.species_type_id).filter(Species.id.in_(species_ids)).all()  # type: ignore[union-attr]
    found_ids = {row.id for row in rows}
    invalid_ids = set(species_ids) - found_ids
    if invalid_ids:
        raise HTTPException(status_code=400, detail=f"Invalid species IDs: {invalid_ids}")
    outside_ids = {row.id for row in rows if row.species_type_id not in species_type_ids}
    if outside_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Species IDs outside the selected species types: {outside_ids}"
        )


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

    # Parent route names, so sector locations read as "<parent> - child".
    parent_ids = {loc.parent_location_id for loc in locations if loc.parent_location_id}
    parent_names: dict[int, str] = (
        dict(
            db.query(Location.id, Location.name)
            .filter(Location.id.in_(parent_ids), Location.organisation_id == org.id)  # type: ignore[union-attr]
            .all()
        )
        if parent_ids
        else {}
    )

    # Get associated species types (global data, no org filter)
    species_types = (
        db.query(SpeciesType)
        .join(SurveyTypeSpeciesTypeLink, SurveyTypeSpeciesTypeLink.species_type_id == SpeciesType.id)
        .filter(SurveyTypeSpeciesTypeLink.survey_type_id == survey_type_id)
        .order_by(SpeciesType.display_name)
        .all()
    )

    # Explicit species narrowing (empty = all species in the species types)
    narrowed_species = (
        db.query(Species)
        .join(SurveyTypeSpeciesLink, SurveyTypeSpeciesLink.species_id == Species.id)
        .filter(SurveyTypeSpeciesLink.survey_type_id == survey_type_id)
        .order_by(func.coalesce(Species.name, Species.scientific_name))
        .all()
    )

    # Build response
    return SurveyTypeWithDetails(
        id=survey_type.id,
        name=survey_type.name,
        description=survey_type.description,
        location_at_sighting_level=survey_type.location_at_sighting_level,
        allow_geolocation=survey_type.allow_geolocation,
        allow_coordinate_entry=survey_type.allow_coordinate_entry,
        allow_sighting_notes=survey_type.allow_sighting_notes,
        allow_audio_upload=survey_type.allow_audio_upload,
        allow_image_upload=survey_type.allow_image_upload,
        allow_sighting_photo_upload=survey_type.allow_sighting_photo_upload,
        allow_start_end_time=survey_type.allow_start_end_time,
        allow_sun_percentage=survey_type.allow_sun_percentage,
        allow_temperature=survey_type.allow_temperature,
        allow_show_description=survey_type.allow_show_description,
        allow_sighting_device_selection=survey_type.allow_sighting_device_selection,
        sighting_device_type=survey_type.sighting_device_type,
        icon=survey_type.icon,
        color=survey_type.color,
        schedule_cadence=survey_type.schedule_cadence,
        is_active=survey_type.is_active,
        locations=[
            LocationRead.model_validate(
                loc,
                update={
                    "parent_name": parent_names.get(loc.parent_location_id)
                    if loc.parent_location_id
                    else None
                },
            )
            for loc in locations
        ],
        species_types=[SpeciesTypeRead.model_validate(st) for st in species_types],
        species=[_to_species_read(s) for s in narrowed_species]
    )


@router.post("", response_model=SurveyTypeRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin_role)])
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

    _validate_species_ids(survey_type.species_ids, set(survey_type.species_type_ids), db)

    _validate_sighting_device_selection(survey_type)

    # Create survey type
    db_survey_type = SurveyType(
        name=survey_type.name,
        description=survey_type.description,
        location_at_sighting_level=survey_type.location_at_sighting_level,
        allow_geolocation=survey_type.allow_geolocation,
        allow_coordinate_entry=survey_type.allow_coordinate_entry,
        allow_sighting_notes=survey_type.allow_sighting_notes,
        allow_audio_upload=survey_type.allow_audio_upload,
        allow_image_upload=survey_type.allow_image_upload,
        allow_sighting_photo_upload=survey_type.allow_sighting_photo_upload,
        allow_start_end_time=survey_type.allow_start_end_time,
        allow_sun_percentage=survey_type.allow_sun_percentage,
        allow_temperature=survey_type.allow_temperature,
        allow_show_description=survey_type.allow_show_description,
        allow_sighting_device_selection=survey_type.allow_sighting_device_selection,
        sighting_device_type=survey_type.sighting_device_type,
        icon=survey_type.icon,
        color=survey_type.color,
        schedule_cadence=survey_type.schedule_cadence,
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

    # Add explicit species links (empty = all species in the species types)
    for species_id in survey_type.species_ids:
        db.add(SurveyTypeSpeciesLink(survey_type_id=db_survey_type.id, species_id=species_id))

    db.commit()
    db.refresh(db_survey_type)
    return db_survey_type


@router.put("/{survey_type_id}", response_model=SurveyTypeRead, dependencies=[Depends(require_admin_role)])
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
    update_data = survey_type.model_dump(exclude_unset=True, exclude={'location_ids', 'species_type_ids', 'species_ids'})
    for field, value in update_data.items():
        setattr(db_survey_type, field, value)

    _validate_sighting_device_selection(db_survey_type)

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

    # Update explicit species links if provided
    if survey_type.species_ids is not None:
        # Validate against the final species-type set (provided or existing)
        if survey_type.species_type_ids is not None:
            final_type_ids = set(survey_type.species_type_ids)
        else:
            final_type_ids = {
                row.species_type_id
                for row in db.query(SurveyTypeSpeciesTypeLink.species_type_id)
                .filter(SurveyTypeSpeciesTypeLink.survey_type_id == survey_type_id)
                .all()
            }
        _validate_species_ids(survey_type.species_ids, final_type_ids, db)

        db.query(SurveyTypeSpeciesLink).filter(SurveyTypeSpeciesLink.survey_type_id == survey_type_id).delete()
        for species_id in survey_type.species_ids:
            db.add(SurveyTypeSpeciesLink(survey_type_id=survey_type_id, species_id=species_id))
    elif survey_type.species_type_ids is not None:
        # Species types changed without an explicit species list: prune any
        # narrowed species that fall outside the new species types.
        allowed_species_subquery = db.query(Species.id).filter(
            col(Species.species_type_id).in_(survey_type.species_type_ids)
        )
        db.query(SurveyTypeSpeciesLink).filter(
            SurveyTypeSpeciesLink.survey_type_id == survey_type_id,
            ~col(SurveyTypeSpeciesLink.species_id).in_(allowed_species_subquery),
        ).delete(synchronize_session=False)

    db.commit()
    db.refresh(db_survey_type)
    return db_survey_type  # type: ignore[no-any-return]


@router.delete("/{survey_type_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin_role)])
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


@router.post("/{survey_type_id}/reactivate", response_model=SurveyTypeRead, dependencies=[Depends(require_admin_role)])
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


# ============================================================================
# Survey Type Files (reference files: methodology PDFs, recording forms, etc.)
# ============================================================================

@router.get("/{survey_type_id}/files", response_model=List[SurveyTypeFileRead])
async def list_survey_type_files(
    survey_type_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> List[SurveyTypeFile]:
    """List reference files for a survey type (most recent first)."""
    _get_owned_survey_type(survey_type_id, org, db)
    files = (
        db.query(SurveyTypeFile)
        .filter(SurveyTypeFile.survey_type_id == survey_type_id)
        .order_by(col(SurveyTypeFile.created_at).desc())
        .all()
    )
    return files  # type: ignore[no-any-return]


@router.post(
    "/{survey_type_id}/files",
    response_model=SurveyTypeFileRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_role)],
)
async def upload_survey_type_file(
    survey_type_id: int,
    file: UploadFile = File(...),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> SurveyTypeFile:
    """Upload a reference file to a survey type. Stored in R2."""
    _get_owned_survey_type(survey_type_id, org, db)

    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    # Determine file size (reject empty or oversized files)
    file.file.seek(0, 2)
    size_bytes = file.file.tell()
    file.file.seek(0)
    if size_bytes == 0:
        raise HTTPException(status_code=400, detail="File is empty")
    if size_bytes > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds maximum size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB",
        )

    # Check for duplicate before touching R2: the key is derived from the
    # filename, so a re-upload would overwrite the existing object and then
    # fail the unique constraint on r2_key.
    existing = (
        db.query(SurveyTypeFile)
        .filter(
            SurveyTypeFile.survey_type_id == survey_type_id,
            SurveyTypeFile.filename == file.filename,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400, detail=f"File already exists: {file.filename}"
        )

    content_type = file.content_type or "application/octet-stream"
    # Scope the R2 key by survey type so filenames can't collide across types
    scoped_filename = f"survey_type_{survey_type_id}/{file.filename}"
    r2_key = upload_media_file(
        file.file, scoped_filename, org.slug, MediaType.REFERENCE, content_type
    )

    db_file = SurveyTypeFile(
        survey_type_id=survey_type_id,
        organisation_id=org.id,
        filename=file.filename,
        content_type=content_type,
        size_bytes=size_bytes,
        r2_key=r2_key,
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    return db_file


@router.get("/{survey_type_id}/files/{file_id}/download")
async def get_survey_type_file_download_url(
    survey_type_id: int,
    file_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> dict:
    """Get a presigned URL to download a reference file."""
    db_file = (
        db.query(SurveyTypeFile)
        .filter(
            SurveyTypeFile.id == file_id,
            SurveyTypeFile.survey_type_id == survey_type_id,
            SurveyTypeFile.organisation_id == org.id,
        )
        .first()
    )
    if not db_file:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    url = generate_media_presigned_url(db_file.r2_key, expires_in=3600)
    return {"download_url": url, "expires_in": 3600, "filename": db_file.filename}


@router.delete(
    "/{survey_type_id}/files/{file_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin_role)],
)
async def delete_survey_type_file(
    survey_type_id: int,
    file_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> None:
    """Delete a reference file from a survey type (removes R2 object and row)."""
    db_file = (
        db.query(SurveyTypeFile)
        .filter(
            SurveyTypeFile.id == file_id,
            SurveyTypeFile.survey_type_id == survey_type_id,
            SurveyTypeFile.organisation_id == org.id,
        )
        .first()
    )
    if not db_file:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found")

    # Best-effort R2 cleanup; always remove the DB row
    delete_media_file(db_file.r2_key)
    db.delete(db_file)
    db.commit()
    return None
