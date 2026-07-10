"""
Species Router - API endpoints for species management

Endpoints:
  GET    /api/species                            - List all species
  GET    /api/species/by-survey-type/{id}        - Get species for survey type
  POST   /api/species                            - Create new species
  GET    /api/species/{id}                       - Get specific species
  PUT    /api/species/{id}                       - Update species
  DELETE /api/species/{id}                       - Delete species

Refactored to use SQLModel ORM instead of raw SQL.
"""

from fastapi import APIRouter, HTTPException, status, Depends
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from database.connection import get_db
from models import (
    Species,
    SpeciesRead,
    SpeciesCreate,
    SpeciesUpdate,
    SpeciesType,
    SurveyTypeSpeciesTypeLink,
)
from auth import require_admin_role

router = APIRouter()


def _to_species_read(species: Species) -> SpeciesRead:
    """Convert a Species ORM object to SpeciesRead, deriving type from relationship."""
    return SpeciesRead(
        id=species.id,
        name=species.name,
        conservation_status=species.conservation_status,
        species_type_id=species.species_type_id,
        type=species.species_type.name if species.species_type else "",
        scientific_name=species.scientific_name,
        nbn_atlas_guid=species.nbn_atlas_guid,
        species_code=species.species_code,
    )


@router.get("", response_model=List[SpeciesRead])
async def get_species(
    survey_type: Optional[str] = None,
    db: Session = Depends(get_db)
) -> List[SpeciesRead]:
    """
    Get all species, optionally filtered by type.

    Args:
        survey_type: Filter by species type name (butterfly, bird, fungi). Optional.

    Returns:
        List of species
    """
    query = db.query(Species).join(Species.species_type)

    if survey_type:
        query = query.filter(SpeciesType.name == survey_type)

    species = query.order_by(
        func.coalesce(Species.name, Species.scientific_name)
    ).all()

    return [_to_species_read(s) for s in species]


@router.get("/by-survey-type/{survey_type_id}", response_model=List[SpeciesRead])
async def get_species_by_survey_type(
    survey_type_id: int,
    db: Session = Depends(get_db)
) -> List[SpeciesRead]:
    """
    Get species available for a specific survey type.

    Filters species based on the species types configured for the survey type.

    Args:
        survey_type_id: The survey type ID to filter by

    Returns:
        List of species whose type matches one of the survey type's allowed species types
    """
    species = db.query(Species).join(
        Species.species_type
    ).join(
        SurveyTypeSpeciesTypeLink,
        SurveyTypeSpeciesTypeLink.species_type_id == Species.species_type_id
    ).filter(
        SurveyTypeSpeciesTypeLink.survey_type_id == survey_type_id
    ).order_by(
        func.coalesce(Species.name, Species.scientific_name)
    ).all()

    return [_to_species_read(s) for s in species]


@router.get("/{species_id}", response_model=SpeciesRead)
async def get_species_by_id(
    species_id: int,
    db: Session = Depends(get_db)
) -> SpeciesRead:
    """Get a specific species by ID"""
    species = db.query(Species).join(Species.species_type).filter(Species.id == species_id).first()
    if not species:
        raise HTTPException(status_code=404, detail=f"Species {species_id} not found")
    return _to_species_read(species)


@router.post("", response_model=SpeciesRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin_role)])
async def create_species(
    species: SpeciesCreate,
    db: Session = Depends(get_db)
) -> SpeciesRead:
    """Create a new species"""
    # Validate species_type_id exists
    species_type = db.query(SpeciesType).filter(SpeciesType.id == species.species_type_id).first()
    if not species_type:
        raise HTTPException(status_code=400, detail=f"Invalid species_type_id: {species.species_type_id}")

    db_species = Species(
        name=species.name,
        conservation_status=species.conservation_status,
        species_type_id=species.species_type_id,
        scientific_name=species.scientific_name,
        nbn_atlas_guid=species.nbn_atlas_guid,
        species_code=species.species_code,
    )
    db.add(db_species)
    db.commit()
    db.refresh(db_species)
    return _to_species_read(db_species)


@router.put("/{species_id}", response_model=SpeciesRead, dependencies=[Depends(require_admin_role)])
async def update_species(
    species_id: int,
    species: SpeciesUpdate,
    db: Session = Depends(get_db)
) -> SpeciesRead:
    """Update an existing species"""
    db_species = db.query(Species).join(Species.species_type).filter(Species.id == species_id).first()
    if not db_species:
        raise HTTPException(status_code=404, detail=f"Species {species_id} not found")

    # Validate species_type_id if provided
    update_data = species.model_dump(exclude_unset=True)
    if 'species_type_id' in update_data:
        species_type = db.query(SpeciesType).filter(SpeciesType.id == update_data['species_type_id']).first()
        if not species_type:
            raise HTTPException(status_code=400, detail=f"Invalid species_type_id: {update_data['species_type_id']}")

    for field, value in update_data.items():
        setattr(db_species, field, value)

    db.commit()
    db.refresh(db_species)
    return _to_species_read(db_species)


@router.delete("/{species_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin_role)])
async def delete_species(
    species_id: int,
    db: Session = Depends(get_db)
) -> None:
    """Delete a species"""
    db_species = db.query(Species).filter(Species.id == species_id).first()
    if not db_species:
        raise HTTPException(status_code=404, detail=f"Species {species_id} not found")

    db.delete(db_species)
    db.commit()
    return None
