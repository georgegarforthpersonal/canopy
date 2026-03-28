"""
Surveys Router - RESTful API endpoints for survey management

Endpoints:
  GET    /api/surveys              - List all surveys
  POST   /api/surveys              - Create new survey
  GET    /api/surveys/{id}         - Get specific survey
  PUT    /api/surveys/{id}         - Update survey
  DELETE /api/surveys/{id}         - Delete survey
  GET    /api/surveys/{id}/sightings   - Get sightings for survey
  POST   /api/surveys/{id}/sightings   - Add sighting to survey
  PUT    /api/surveys/{id}/sightings/{sighting_id}    - Update sighting
  DELETE /api/surveys/{id}/sightings/{sighting_id}    - Delete sighting

Refactored to use SQLModel ORM instead of raw SQL.
"""

from fastapi import APIRouter, HTTPException, status, Depends, Query
from typing import List, Optional, Any
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from sqlmodel import col
from database.connection import get_db
from auth import require_admin
from dependencies import get_current_organisation
import logging
from models import (
    Survey, SurveyRead, SurveyCreate, SurveyUpdate,
    Sighting, SightingCreate, SightingUpdate, SightingWithDetails,
    Species, SpeciesType, Location, SurveySurveyor,
    BreedingStatusCode, BreedingStatusCodeRead,
    IndividualLocationCreate, IndividualLocationRead, SightingWithIndividuals,
    Organisation
)
from services.r2_storage import delete_media_file

logger = logging.getLogger(__name__)

router = APIRouter()

# ============================================================================
# Breeding Status Codes (BTO breeding evidence codes)
# IMPORTANT: This route must come BEFORE /{survey_id} to avoid route conflicts
# ============================================================================

@router.get("/breeding-codes", response_model=List[BreedingStatusCodeRead])
async def get_breeding_codes(db: Session = Depends(get_db)) -> List[dict[str, Any]]:
    """
    Get all BTO breeding status codes grouped by category.

    Returns:
        List of breeding status codes with code, description, and category.
        Categories: non_breeding, possible_breeder, probable_breeder, confirmed_breeder
    """
    codes = db.query(BreedingStatusCode).order_by(
        BreedingStatusCode.category,
        BreedingStatusCode.code
    ).all()

    return [{
        "code": code.code,
        "description": code.description,
        "full_description": code.full_description,
        "category": code.category.value if hasattr(code.category, 'value') else str(code.category)
    } for code in codes]


# ============================================================================
# Survey CRUD Operations
# ============================================================================

@router.get("")
async def get_surveys(
    page: int = Query(1, ge=1, description="Page number (starting from 1)"),
    limit: int = Query(25, ge=1, le=100, description="Items per page"),
    start_date: Optional[date] = Query(None, description="Filter surveys from this date (inclusive)"),
    end_date: Optional[date] = Query(None, description="Filter surveys until this date (inclusive)"),
    survey_type_id: Optional[int] = Query(None, description="Filter by survey type ID"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """
    Get surveys with pagination and optional filtering.

    Args:
        page: Page number (starting from 1)
        limit: Number of items per page (max 100)
        start_date: Optional start date filter (YYYY-MM-DD)
        end_date: Optional end date filter (YYYY-MM-DD)
        survey_type_id: Optional survey type ID filter

    Returns:
        Paginated list of surveys with metadata:
        - data: List of surveys with sighting counts and species breakdown
        - page: Current page number
        - limit: Items per page
        - total: Total number of surveys (after filtering)
        - total_pages: Total number of pages
    """
    try:
        # Build base query with filters - always filter by organisation
        query = db.query(Survey).filter(Survey.organisation_id == org.id)

        # Apply date range filters
        if start_date:
            query = query.filter(Survey.date >= start_date)
        if end_date:
            query = query.filter(Survey.date <= end_date)

        # Apply survey type filter
        if survey_type_id:
            query = query.filter(Survey.survey_type_id == survey_type_id)

        # Get total count for pagination metadata
        total = query.count()

        # Calculate pagination
        total_pages = (total + limit - 1) // limit  # Ceiling division
        offset = (page - 1) * limit

        # Get paginated surveys
        surveys_query = (
            query.order_by(col(Survey.date).desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        # Extract survey IDs for batch queries (filter out None values)
        survey_ids: list[int] = [s.id for s in surveys_query if s.id is not None]

        # Batch query 1: Get all surveyor IDs for these surveys
        surveyor_data = db.query(
            SurveySurveyor.survey_id,
            SurveySurveyor.surveyor_id
        ).filter(
            col(SurveySurveyor.survey_id).in_(survey_ids)
        ).order_by(
            SurveySurveyor.survey_id,
            SurveySurveyor.surveyor_id
        ).all()

        # Build surveyor_ids lookup: {survey_id: [surveyor_ids]}
        surveyor_ids_map: dict[int, list[int]] = {sid: [] for sid in survey_ids}
        for row in surveyor_data:
            surveyor_ids_map[row.survey_id].append(row.surveyor_id)

        # Batch query 2: Get sighting counts for all surveys
        sightings_counts = db.query(
            Sighting.survey_id,
            func.count(Sighting.id).label('count')
        ).filter(
            col(Sighting.survey_id).in_(survey_ids)
        ).group_by(
            Sighting.survey_id
        ).all()

        # Build sightings count lookup: {survey_id: count}
        sightings_count_map: dict[int, int] = {sid: 0 for sid in survey_ids}
        for row in sightings_counts:
            sightings_count_map[row.survey_id] = row.count

        # Batch query 3: Get species breakdown for all surveys
        species_breakdown_data = db.query(
            Sighting.survey_id,
            col(SpeciesType.name).label('type'),
            func.count(func.distinct(Species.id)).label('count')
        ).join(
            Species, Species.id == Sighting.species_id
        ).join(
            SpeciesType, SpeciesType.id == Species.species_type_id
        ).filter(
            col(Sighting.survey_id).in_(survey_ids)
        ).group_by(
            Sighting.survey_id,
            SpeciesType.name
        ).all()

        # Build species breakdown lookup: {survey_id: [{"type": ..., "count": ...}]}
        species_breakdown_map: dict[int, list[dict[str, Any]]] = {sid: [] for sid in survey_ids}
        for row in species_breakdown_data:
            species_breakdown_map[row.survey_id].append({
                "type": row.type,
                "count": row.count
            })

        result = []
        for survey in surveys_query:
            # Get survey type name, icon, and color if available
            survey_type_name = None
            survey_type_icon = None
            survey_type_color = None
            if survey.survey_type:
                survey_type_name = survey.survey_type.name
                survey_type_icon = survey.survey_type.icon
                survey_type_color = survey.survey_type.color

            result.append({
                "id": survey.id,
                "date": survey.date,
                "start_time": survey.start_time,
                "end_time": survey.end_time,
                "sun_percentage": survey.sun_percentage,
                "temperature_celsius": survey.temperature_celsius,
                "conditions_met": survey.conditions_met,
                "notes": survey.notes,
                "location_id": survey.location_id,
                "device_id": survey.device_id,
                "surveyor_ids": surveyor_ids_map.get(survey.id, []),
                "sightings_count": sightings_count_map.get(survey.id, 0),
                "species_breakdown": species_breakdown_map.get(survey.id, []),
                "survey_type_id": survey.survey_type_id,
                "survey_type_name": survey_type_name,
                "survey_type_icon": survey_type_icon,
                "survey_type_color": survey_type_color
            })

        return {
            "data": result,
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": total_pages
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch surveys: {str(e)}")


@router.get("/{survey_id}", response_model=SurveyRead)
async def get_survey(
    survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """
    Get a specific survey by ID.

    Args:
        survey_id: Survey ID

    Returns:
        Survey details

    Raises:
        404: Survey not found
    """
    survey = db.query(Survey).filter(
        Survey.id == survey_id,
        Survey.organisation_id == org.id
    ).first()
    if not survey:
        raise HTTPException(status_code=404, detail=f"Survey {survey_id} not found")

    # Get surveyor IDs
    surveyor_ids = db.query(SurveySurveyor.surveyor_id)\
        .filter(SurveySurveyor.survey_id == survey_id)\
        .order_by(SurveySurveyor.surveyor_id)\
        .all()
    surveyor_ids_list = [sid[0] for sid in surveyor_ids]

    return {
        "id": survey.id,
        "date": survey.date,
        "start_time": survey.start_time,
        "end_time": survey.end_time,
        "sun_percentage": survey.sun_percentage,
        "temperature_celsius": survey.temperature_celsius,
        "conditions_met": survey.conditions_met,
        "notes": survey.notes,
        "location_id": survey.location_id,
        "device_id": survey.device_id,
        "surveyor_ids": surveyor_ids_list,
        "survey_type_id": survey.survey_type_id
    }


@router.post("", response_model=SurveyRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def create_survey(
    survey: SurveyCreate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """
    Create a new survey.

    Args:
        survey: Survey data

    Returns:
        Created survey with ID
    """
    try:
        # Create survey (without surveyor_ids which isn't a field on the model)
        db_survey = Survey(
            date=survey.date,
            start_time=survey.start_time,
            end_time=survey.end_time,
            sun_percentage=survey.sun_percentage,
            temperature_celsius=survey.temperature_celsius,
            conditions_met=survey.conditions_met,
            notes=survey.notes,
            location_id=survey.location_id,
            device_id=survey.device_id,
            survey_type_id=survey.survey_type_id,
            organisation_id=org.id
        )
        db.add(db_survey)
        db.flush()  # Get the ID without committing

        # Insert surveyor associations
        for surveyor_id in survey.surveyor_ids:
            db_association = SurveySurveyor(
                survey_id=db_survey.id,
                surveyor_id=surveyor_id
            )
            db.add(db_association)

        db.commit()
        db.refresh(db_survey)

        return {
            "id": db_survey.id,
            "date": db_survey.date,
            "start_time": db_survey.start_time,
            "end_time": db_survey.end_time,
            "sun_percentage": db_survey.sun_percentage,
            "temperature_celsius": db_survey.temperature_celsius,
            "conditions_met": db_survey.conditions_met,
            "notes": db_survey.notes,
            "location_id": db_survey.location_id,
            "device_id": db_survey.device_id,
            "survey_type_id": db_survey.survey_type_id,
            "surveyor_ids": survey.surveyor_ids
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create survey: {str(e)}")


@router.put("/{survey_id}", response_model=SurveyRead, dependencies=[Depends(require_admin)])
async def update_survey(
    survey_id: int,
    survey: SurveyUpdate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """
    Update an existing survey.

    Args:
        survey_id: Survey ID
        survey: Updated survey data

    Returns:
        Updated survey

    Raises:
        404: Survey not found
    """
    db_survey = db.query(Survey).filter(
        Survey.id == survey_id,
        Survey.organisation_id == org.id
    ).first()
    if not db_survey:
        raise HTTPException(status_code=404, detail=f"Survey {survey_id} not found")

    # Update only the fields that were provided
    update_data = survey.model_dump(exclude_unset=True, exclude={'surveyor_ids'})

    for field, value in update_data.items():
        setattr(db_survey, field, value)

    # Update surveyor associations if provided
    if survey.surveyor_ids is not None:
        # Delete existing associations
        db.query(SurveySurveyor)\
            .filter(SurveySurveyor.survey_id == survey_id)\
            .delete()

        # Insert new associations
        for surveyor_id in survey.surveyor_ids:
            db_association = SurveySurveyor(
                survey_id=survey_id,
                surveyor_id=surveyor_id
            )
            db.add(db_association)

    db.commit()
    db.refresh(db_survey)

    # Get current surveyor IDs
    surveyor_ids = db.query(SurveySurveyor.surveyor_id)\
        .filter(SurveySurveyor.survey_id == survey_id)\
        .order_by(SurveySurveyor.surveyor_id)\
        .all()
    surveyor_ids_list = [sid[0] for sid in surveyor_ids]

    return {
        "id": db_survey.id,
        "date": db_survey.date,
        "start_time": db_survey.start_time,
        "end_time": db_survey.end_time,
        "sun_percentage": db_survey.sun_percentage,
        "temperature_celsius": db_survey.temperature_celsius,
        "conditions_met": db_survey.conditions_met,
        "notes": db_survey.notes,
        "location_id": db_survey.location_id,
        "device_id": db_survey.device_id,
        "survey_type_id": db_survey.survey_type_id,
        "surveyor_ids": surveyor_ids_list
    }


@router.delete("/{survey_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_survey(
    survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> None:
    """
    Delete a survey (CASCADE deletes sightings and surveyor associations).

    Args:
        survey_id: Survey ID

    Raises:
        404: Survey not found
    """
    db_survey = db.query(Survey).filter(
        Survey.id == survey_id,
        Survey.organisation_id == org.id
    ).first()
    if not db_survey:
        raise HTTPException(status_code=404, detail=f"Survey {survey_id} not found")

    # Collect R2 keys before cascade deletes the records
    r2_keys_to_delete = []
    for rec in db_survey.audio_recordings:
        if rec.r2_key:
            r2_keys_to_delete.append(rec.r2_key)
    for img in db_survey.camera_trap_images:
        if img.r2_key:
            r2_keys_to_delete.append(img.r2_key)

    db.delete(db_survey)
    db.commit()

    # Best-effort R2 cleanup after successful DB commit
    for key in r2_keys_to_delete:
        try:
            delete_media_file(key)
        except Exception:
            logger.warning(f"Failed to delete R2 file: {key}")

    return None


# ============================================================================
# Sightings Operations (Nested under surveys)
# ============================================================================

@router.get("/{survey_id}/sightings", response_model=List[SightingWithIndividuals])
async def get_survey_sightings(
    survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[dict[str, Any]]:
    """
    Get all sightings for a survey, including individual location points.

    Args:
        survey_id: Survey ID

    Returns:
        List of sightings with species details, legacy coordinates, and individual location points

    Raises:
        404: Survey not found
    """
    # Check if survey exists and belongs to this organisation
    survey = db.query(Survey).filter(
        Survey.id == survey_id,
        Survey.organisation_id == org.id
    ).first()
    if not survey:
        raise HTTPException(status_code=404, detail=f"Survey {survey_id} not found")

    # Get sightings with species names and location names
    sightings = db.query(
        Sighting.id,
        Sighting.survey_id,
        Sighting.species_id,
        Sighting.location_id,
        Sighting.count,
        Sighting.notes,
        Species.name.label('species_name'),  # type: ignore[union-attr]
        Species.scientific_name.label('species_scientific_name'),  # type: ignore[union-attr]
        col(Location.name).label('location_name')
    ).join(Species, Sighting.species_id == Species.id)\
     .outerjoin(Location, Sighting.location_id == Location.id)\
     .filter(Sighting.survey_id == survey_id)\
     .order_by(func.coalesce(Species.name, Species.scientific_name))\
     .all()

    result = []
    for row in sightings:
        # Fetch individual locations for this sighting
        individuals = db.execute(text("""
            SELECT id, ST_Y(coordinates) as latitude, ST_X(coordinates) as longitude,
                   count, breeding_status_code, notes, camera_trap_image_id
            FROM sighting_individual
            WHERE sighting_id = :sighting_id
            ORDER BY id
        """).bindparams(sighting_id=row.id)).fetchall()

        result.append({
            "id": row.id,
            "survey_id": row.survey_id,
            "species_id": row.species_id,
            "location_id": row.location_id,
            "location_name": row.location_name,
            "count": row.count,
            "notes": row.notes,
            "species_name": row.species_name,
            "species_scientific_name": row.species_scientific_name,
            "individuals": [
                {
                    "id": ind.id,
                    "latitude": ind.latitude,
                    "longitude": ind.longitude,
                    "count": ind.count,
                    "breeding_status_code": ind.breeding_status_code,
                    "notes": ind.notes,
                    "camera_trap_image_id": ind.camera_trap_image_id
                }
                for ind in individuals
            ]
        })

    return result


@router.post("/{survey_id}/sightings", response_model=SightingWithIndividuals, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def create_sighting(
    survey_id: int,
    sighting: SightingCreate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """
    Add a sighting to a survey with optional individual location points.

    Args:
        survey_id: Survey ID
        sighting: Sighting data with optional individuals array

    Returns:
        Created sighting with individuals

    Raises:
        404: Survey or species not found
    """
    # Check if survey exists and belongs to this organisation
    survey = db.query(Survey).filter(
        Survey.id == survey_id,
        Survey.organisation_id == org.id
    ).first()
    if not survey:
        raise HTTPException(status_code=404, detail=f"Survey {survey_id} not found")

    # Validate that sum of individual counts doesn't exceed sighting count
    if sighting.individuals:
        total_individual_count = sum(ind.count for ind in sighting.individuals)
        if total_individual_count > sighting.count:
            raise HTTPException(
                status_code=400,
                detail=f"Sum of individual counts ({total_individual_count}) exceeds sighting count ({sighting.count})"
            )

    # Create sighting
    db_sighting = Sighting(
        survey_id=survey_id,
        species_id=sighting.species_id,
        count=sighting.count,
        location_id=sighting.location_id
    )

    db.add(db_sighting)
    db.commit()
    db.refresh(db_sighting)

    # Create individual location records
    for ind in sighting.individuals:
        db.execute(
            text("""
                INSERT INTO sighting_individual (sighting_id, coordinates, count, breeding_status_code, notes, camera_trap_image_id)
                VALUES (:sighting_id, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :count, :code, :notes, :camera_trap_image_id)
            """).bindparams(
                sighting_id=db_sighting.id,
                lng=ind.longitude,
                lat=ind.latitude,
                count=ind.count,
                code=ind.breeding_status_code,
                notes=ind.notes,
                camera_trap_image_id=ind.camera_trap_image_id
            )
        )
    db.commit()

    # Get species name
    species = db.query(Species).filter(Species.id == sighting.species_id).first()

    # Fetch created individuals
    individuals = db.execute(text("""
        SELECT id, ST_Y(coordinates) as latitude, ST_X(coordinates) as longitude,
               count, breeding_status_code, notes, camera_trap_image_id
        FROM sighting_individual
        WHERE sighting_id = :sighting_id
        ORDER BY id
    """).bindparams(sighting_id=db_sighting.id)).fetchall()

    return {
        "id": db_sighting.id,
        "survey_id": db_sighting.survey_id,
        "species_id": db_sighting.species_id,
        "count": db_sighting.count,
        "species_name": species.name if species else None,
        "species_scientific_name": species.scientific_name if species else None,
        "individuals": [
            {
                "id": ind.id,
                "latitude": ind.latitude,
                "longitude": ind.longitude,
                "count": ind.count,
                "breeding_status_code": ind.breeding_status_code,
                "notes": ind.notes
            }
            for ind in individuals
        ]
    }


@router.put("/{survey_id}/sightings/{sighting_id}", response_model=SightingWithDetails, dependencies=[Depends(require_admin)])
async def update_sighting(
    survey_id: int,
    sighting_id: int,
    sighting: SightingUpdate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """
    Update a sighting.

    Args:
        survey_id: Survey ID
        sighting_id: Sighting ID
        sighting: Updated sighting data

    Returns:
        Updated sighting

    Raises:
        404: Survey or sighting not found
    """
    # Check if sighting exists and belongs to this survey (which belongs to this org)
    db_sighting = db.query(Sighting)\
        .join(Survey)\
        .filter(
            Sighting.id == sighting_id,
            Sighting.survey_id == survey_id,
            Survey.organisation_id == org.id
        ).first()

    if not db_sighting:
        raise HTTPException(
            status_code=404,
            detail=f"Sighting {sighting_id} not found for survey {survey_id}"
        )

    # Update sighting fields
    update_data = sighting.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(db_sighting, field, value)

    db.commit()
    db.refresh(db_sighting)

    # Get species name
    species = db.query(Species).filter(Species.id == db_sighting.species_id).first()

    return {
        "id": db_sighting.id,
        "survey_id": db_sighting.survey_id,
        "species_id": db_sighting.species_id,
        "count": db_sighting.count,
        "species_name": species.name if species else None,
        "species_scientific_name": species.scientific_name if species else None
    }


@router.delete("/{survey_id}/sightings/{sighting_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_sighting(
    survey_id: int,
    sighting_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> None:
    """
    Delete a sighting.

    Args:
        survey_id: Survey ID
        sighting_id: Sighting ID

    Raises:
        404: Survey or sighting not found
    """
    db_sighting = db.query(Sighting)\
        .join(Survey)\
        .filter(
            Sighting.id == sighting_id,
            Sighting.survey_id == survey_id,
            Survey.organisation_id == org.id
        ).first()

    if not db_sighting:
        raise HTTPException(
            status_code=404,
            detail=f"Sighting {sighting_id} not found for survey {survey_id}"
        )

    db.delete(db_sighting)
    db.commit()
    return None


# ============================================================================
# Individual Location Operations (Nested under sightings)
# ============================================================================

@router.post("/{survey_id}/sightings/{sighting_id}/individuals", response_model=IndividualLocationRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
async def add_individual_location(
    survey_id: int,
    sighting_id: int,
    individual: IndividualLocationCreate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """
    Add an individual location to an existing sighting.

    Args:
        survey_id: Survey ID
        sighting_id: Sighting ID
        individual: Individual location data

    Returns:
        Created individual location

    Raises:
        404: Survey or sighting not found
    """
    # Verify sighting belongs to survey (which belongs to this org)
    db_sighting = db.query(Sighting)\
        .join(Survey)\
        .filter(
            Sighting.id == sighting_id,
            Sighting.survey_id == survey_id,
            Survey.organisation_id == org.id
        ).first()

    if not db_sighting:
        raise HTTPException(
            status_code=404,
            detail=f"Sighting {sighting_id} not found for survey {survey_id}"
        )

    # Auto-increment sighting count to accommodate the new individual
    db_sighting.count += individual.count
    db.add(db_sighting)

    # Insert individual location
    result = db.execute(
        text("""
            INSERT INTO sighting_individual (sighting_id, coordinates, count, breeding_status_code, notes, camera_trap_image_id)
            VALUES (:sighting_id, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), :count, :code, :notes, :camera_trap_image_id)
            RETURNING id, ST_Y(coordinates) as latitude, ST_X(coordinates) as longitude, count, breeding_status_code, notes, camera_trap_image_id
        """).bindparams(
            sighting_id=sighting_id,
            lng=individual.longitude,
            lat=individual.latitude,
            count=individual.count,
            code=individual.breeding_status_code,
            notes=individual.notes,
            camera_trap_image_id=individual.camera_trap_image_id
        )
    ).fetchone()
    db.commit()

    return {
        "id": result.id,
        "latitude": result.latitude,
        "longitude": result.longitude,
        "count": result.count,
        "breeding_status_code": result.breeding_status_code,
        "notes": result.notes,
        "camera_trap_image_id": result.camera_trap_image_id
    }


@router.put("/{survey_id}/sightings/{sighting_id}/individuals/{individual_id}", response_model=IndividualLocationRead, dependencies=[Depends(require_admin)])
async def update_individual_location(
    survey_id: int,
    sighting_id: int,
    individual_id: int,
    individual: IndividualLocationCreate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """
    Update an individual location.

    Args:
        survey_id: Survey ID
        sighting_id: Sighting ID
        individual_id: Individual location ID
        individual: Updated individual location data

    Returns:
        Updated individual location

    Raises:
        404: Survey, sighting, or individual not found
    """
    # Verify sighting belongs to survey (which belongs to this org)
    db_sighting = db.query(Sighting)\
        .join(Survey)\
        .filter(
            Sighting.id == sighting_id,
            Sighting.survey_id == survey_id,
            Survey.organisation_id == org.id
        ).first()

    if not db_sighting:
        raise HTTPException(
            status_code=404,
            detail=f"Sighting {sighting_id} not found for survey {survey_id}"
        )

    # Check individual exists and get current count
    existing = db.execute(
        text("SELECT id, count FROM sighting_individual WHERE id = :id AND sighting_id = :sighting_id")
        .bindparams(id=individual_id, sighting_id=sighting_id)
    ).fetchone()

    if not existing:
        raise HTTPException(
            status_code=404,
            detail=f"Individual location {individual_id} not found for sighting {sighting_id}"
        )

    # Validate that updating this individual's count won't exceed sighting count
    # Calculate: (total - current_count + new_count) <= sighting.count
    existing_total = db.execute(
        text("SELECT COALESCE(SUM(count), 0) FROM sighting_individual WHERE sighting_id = :sighting_id")
        .bindparams(sighting_id=sighting_id)
    ).scalar()

    new_total = existing_total - existing.count + individual.count
    if new_total > db_sighting.count:
        raise HTTPException(
            status_code=400,
            detail=f"Updating count to {individual.count} would exceed sighting count ({db_sighting.count}). New total would be: {new_total}"
        )

    # Update individual location
    result = db.execute(
        text("""
            UPDATE sighting_individual
            SET coordinates = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                count = :count,
                breeding_status_code = :code,
                notes = :notes
            WHERE id = :id
            RETURNING id, ST_Y(coordinates) as latitude, ST_X(coordinates) as longitude, count, breeding_status_code, notes
        """).bindparams(
            id=individual_id,
            lng=individual.longitude,
            lat=individual.latitude,
            count=individual.count,
            code=individual.breeding_status_code,
            notes=individual.notes
        )
    ).fetchone()
    db.commit()

    return {
        "id": result.id,
        "latitude": result.latitude,
        "longitude": result.longitude,
        "count": result.count,
        "breeding_status_code": result.breeding_status_code,
        "notes": result.notes
    }


@router.delete("/{survey_id}/sightings/{sighting_id}/individuals/{individual_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_individual_location(
    survey_id: int,
    sighting_id: int,
    individual_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> None:
    """
    Remove an individual location from a sighting.

    Args:
        survey_id: Survey ID
        sighting_id: Sighting ID
        individual_id: Individual location ID

    Raises:
        404: Survey, sighting, or individual not found
    """
    # Verify sighting belongs to survey (which belongs to this org)
    db_sighting = db.query(Sighting)\
        .join(Survey)\
        .filter(
            Sighting.id == sighting_id,
            Sighting.survey_id == survey_id,
            Survey.organisation_id == org.id
        ).first()

    if not db_sighting:
        raise HTTPException(
            status_code=404,
            detail=f"Sighting {sighting_id} not found for survey {survey_id}"
        )

    # Get individual's count before deleting, then delete
    result = db.execute(
        text("DELETE FROM sighting_individual WHERE id = :id AND sighting_id = :sighting_id RETURNING id, count")
        .bindparams(id=individual_id, sighting_id=sighting_id)
    ).fetchone()

    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Individual location {individual_id} not found for sighting {sighting_id}"
        )

    # Auto-decrement sighting count
    individual_count = result.count or 1
    db_sighting.count = max(0, db_sighting.count - individual_count)
    db.add(db_sighting)

    db.commit()
    return None
