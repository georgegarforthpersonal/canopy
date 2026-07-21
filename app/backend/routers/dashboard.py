"""
Dashboard Router - API endpoints for dashboard analytics and charts

Endpoints:
  GET /api/dashboard/cumulative-species - Get cumulative unique species counts by date and type
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from typing import List, Optional, Dict, Any
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import text
from database.connection import get_db
from dependencies import get_current_organisation
from models import (
    CumulativeSpeciesResponse,
    CumulativeSpeciesDataPoint,
    DateRange,
    SpeciesOccurrenceResponse,
    SpeciesOccurrenceDataPoint,
    SpeciesWithCount,
    Organisation
)

router = APIRouter()


# ============================================================================
# Helper Functions
# ============================================================================

def build_date_filter_sql(start_date: Optional[date], end_date: Optional[date]) -> str:
    """Build SQL date filter clause and return the WHERE conditions"""
    filters = []
    if start_date:
        filters.append("AND survey.date >= :start_date")
    if end_date:
        filters.append("AND survey.date <= :end_date")
    return ' '.join(filters)


def add_date_params(params: Dict[str, Any], start_date: Optional[date], end_date: Optional[date]) -> None:
    """Add date parameters to params dict if they exist"""
    if start_date:
        params['start_date'] = start_date
    if end_date:
        params['end_date'] = end_date


def determine_date_range(data_points: List, start_date: Optional[date], end_date: Optional[date]) -> DateRange:
    """Determine date range from data points or use filter dates as fallback"""
    if data_points:
        # Handle different date field names (date, survey_date, week_start)
        dates = []
        for dp in data_points:
            if hasattr(dp, 'date'):
                dates.append(dp.date)
            elif hasattr(dp, 'survey_date'):
                dates.append(dp.survey_date)
            elif hasattr(dp, 'week_start'):
                dates.append(dp.week_start)

        if dates:
            return DateRange(start=min(dates), end=max(dates))

    # No data - use filter dates or today
    return DateRange(
        start=start_date or date.today(),
        end=end_date or date.today()
    )


@router.get("/cumulative-species", response_model=CumulativeSpeciesResponse)
async def get_cumulative_species(
    species_types: Optional[List[str]] = Query(None, description="Filter by species types (e.g., 'bird', 'butterfly')"),
    survey_type_id: Optional[int] = Query(None, description="Only count sightings from surveys of this type"),
    start_date: Optional[date] = Query(None, description="Filter surveys from this date (inclusive)"),
    end_date: Optional[date] = Query(None, description="Filter surveys until this date (inclusive)"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> CumulativeSpeciesResponse:
    """
    Get cumulative unique species counts over time for the current organisation.

    Returns the number of distinct species seen cumulatively up to each survey date,
    grouped by species type. This shows how species diversity grows over time.
    Only completed surveys count — scheduled/cancelled surveys have no recorded
    data and would otherwise stretch the series into the future.

    Args:
        species_types: Optional list of species types to filter (e.g., ['bird', 'butterfly'])
        survey_type_id: Optional survey type filter (e.g. a group's survey type)
        start_date: Optional start date filter
        end_date: Optional end date filter
        db: Database session

    Returns:
        CumulativeSpeciesResponse with:
        - data: List of {date, type, cumulative_count} data points
        - date_range: {start, end} date range metadata
    """
    try:
        # Build WHERE clause for species_types filter
        species_filter = ""
        if species_types:
            # SQL injection safe: using parameterized query
            placeholders = ', '.join([f":type_{i}" for i in range(len(species_types))])
            species_filter = f"AND species_type.name IN ({placeholders})"

        survey_type_filter = "AND survey.survey_type_id = :survey_type_id" if survey_type_id is not None else ""

        # Build date filters
        date_filter_sql = build_date_filter_sql(start_date, end_date)

        # SQL query to calculate cumulative unique species counts and new species per date
        query = text(f"""
            WITH first_sightings AS (
                SELECT
                    species.id as species_id,
                    species_type.name as type,
                    COALESCE(species.name, species.scientific_name) as species_name,
                    MIN(survey.date) as first_seen_date
                FROM survey
                JOIN sighting ON survey.id = sighting.survey_id
                JOIN species ON sighting.species_id = species.id
                JOIN species_type ON species.species_type_id = species_type.id
                WHERE survey.organisation_id = :org_id
                AND survey.status = 'completed'
                {survey_type_filter}
                {species_filter}
                {date_filter_sql}
                GROUP BY species.id, species_type.name, species.name, species.scientific_name
            ),
            survey_dates AS (
                SELECT DISTINCT survey.date
                FROM survey
                WHERE survey.organisation_id = :org_id
                AND survey.status = 'completed'
                {survey_type_filter}
                {date_filter_sql}
                ORDER BY survey.date
            ),
            species_types_list AS (
                SELECT DISTINCT type
                FROM first_sightings
            ),
            new_species_per_date AS (
                SELECT
                    survey_dates.date,
                    species_types_list.type,
                    COALESCE(
                        array_agg(first_sightings.species_name ORDER BY first_sightings.species_name)
                        FILTER (WHERE first_sightings.first_seen_date = survey_dates.date),
                        ARRAY[]::text[]
                    ) as new_species_names
                FROM survey_dates
                CROSS JOIN species_types_list
                LEFT JOIN first_sightings
                    ON first_sightings.type = species_types_list.type
                GROUP BY survey_dates.date, species_types_list.type
            )
            SELECT
                survey_dates.date,
                species_types_list.type,
                COALESCE(COUNT(DISTINCT first_sightings.species_id), 0) as cumulative_count,
                new_species_per_date.new_species_names
            FROM survey_dates
            CROSS JOIN species_types_list
            LEFT JOIN first_sightings
                ON first_sightings.first_seen_date <= survey_dates.date
                AND first_sightings.type = species_types_list.type
            LEFT JOIN new_species_per_date
                ON new_species_per_date.date = survey_dates.date
                AND new_species_per_date.type = species_types_list.type
            GROUP BY survey_dates.date, species_types_list.type, new_species_per_date.new_species_names
            ORDER BY species_types_list.type, survey_dates.date
        """)

        # Build parameters dict
        params: Dict[str, Any] = {"org_id": org.id}
        if species_types:
            for i, st in enumerate(species_types):
                params[f'type_{i}'] = st
        if survey_type_id is not None:
            params['survey_type_id'] = survey_type_id
        add_date_params(params, start_date, end_date)

        # Execute query
        result = db.execute(query, params)
        rows = result.fetchall()

        # Transform to response format
        data_points = [
            CumulativeSpeciesDataPoint(
                date=row.date,
                type=row.type,
                cumulative_count=row.cumulative_count,
                new_species=list(row.new_species_names) if row.new_species_names else []
            )
            for row in rows
        ]

        return CumulativeSpeciesResponse(
            data=data_points,
            date_range=determine_date_range(data_points, start_date, end_date)
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch cumulative species data: {str(e)}"
        )


@router.get("/species-types-with-entries", response_model=List[str])
async def get_species_types_with_entries(
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[str]:
    """
    Get species types that have at least one sighting entry for the current organisation.

    Returns a list of species type strings (e.g., 'bird', 'butterfly') that have
    at least one sighting in the database. Useful for filtering dashboard icons
    to only show species types with data.

    Args:
        db: Database session

    Returns:
        List of species type strings with entries, ordered alphabetically
    """
    try:
        query = text("""
            SELECT DISTINCT species_type.name as type
            FROM species
            JOIN species_type ON species.species_type_id = species_type.id
            JOIN sighting ON species.id = sighting.species_id
            JOIN survey ON sighting.survey_id = survey.id
            WHERE survey.organisation_id = :org_id
            ORDER BY species_type.name
        """)

        result = db.execute(query, {"org_id": org.id})
        rows = result.fetchall()

        return [row.type for row in rows]

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch species types with entries: {str(e)}"
        )


@router.get("/species-by-count", response_model=List[SpeciesWithCount])
async def get_species_by_count(
    species_type: str = Query(..., description="Species type to filter (e.g., 'bird', 'butterfly')"),
    survey_type_id: Optional[int] = Query(None, description="Only count sightings from surveys of this type"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[SpeciesWithCount]:
    """
    Get species ordered by total occurrence count (descending) for the current organisation.

    Returns species of a given type with their total count across all completed
    surveys, useful for auto-selecting the most common species. Species with no
    sightings are omitted.

    Args:
        species_type: Species type to filter
        survey_type_id: Optional survey type filter (e.g. a group's survey type)
        db: Database session

    Returns:
        List of species with their total counts, ordered by count descending
    """
    try:
        survey_type_filter = "AND survey.survey_type_id = :survey_type_id" if survey_type_id is not None else ""

        query = text(f"""
            SELECT
                species.id,
                species.name,
                species.scientific_name,
                species_type.name as type,
                SUM(sighting.count) as total_count,
                MIN(survey.date) as first_observed
            FROM species
            JOIN species_type ON species.species_type_id = species_type.id
            JOIN sighting ON species.id = sighting.species_id
            JOIN survey ON sighting.survey_id = survey.id
            WHERE species_type.name = :species_type
              AND survey.organisation_id = :org_id
              AND survey.status = 'completed'
              {survey_type_filter}
            GROUP BY species.id, species.name, species.scientific_name, species_type.name
            HAVING SUM(sighting.count) > 0
            ORDER BY total_count DESC, species.name
        """)

        params: Dict[str, Any] = {"species_type": species_type, "org_id": org.id}
        if survey_type_id is not None:
            params['survey_type_id'] = survey_type_id
        result = db.execute(query, params)
        rows = result.fetchall()

        return [
            SpeciesWithCount(
                id=row.id,
                name=row.name,
                scientific_name=row.scientific_name,
                type=row.type,
                total_count=row.total_count,
                first_observed=row.first_observed,
            )
            for row in rows
        ]

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch species by count: {str(e)}"
        )


@router.get("/species-occurrences", response_model=SpeciesOccurrenceResponse)
async def get_species_occurrences(
    species_id: int = Query(..., description="Species ID to get occurrences for"),
    survey_type_id: Optional[int] = Query(None, description="Only include surveys of this type"),
    start_date: Optional[date] = Query(None, description="Filter from this date (inclusive)"),
    end_date: Optional[date] = Query(None, description="Filter until this date (inclusive)"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> SpeciesOccurrenceResponse:
    """
    Get occurrence counts for a specific species by survey for the current organisation.

    Returns the total count of individuals seen per completed survey for the
    specified species. Each survey date becomes a data point in the chart —
    including zero counts (surveyed, none seen), which are real observations.

    Args:
        species_id: ID of the species to track
        survey_type_id: Optional survey type filter (e.g. a group's survey type)
        start_date: Optional start date filter
        end_date: Optional end date filter
        db: Database session

    Returns:
        SpeciesOccurrenceResponse with occurrence data by survey
    """
    try:
        # Build date filters
        date_filter_sql = build_date_filter_sql(start_date, end_date)
        survey_type_filter = "AND survey.survey_type_id = :survey_type_id" if survey_type_id is not None else ""

        # Query to get occurrences by survey - include ALL completed surveys
        # with 0 for no sightings
        query = text(f"""
            SELECT
                survey.id as survey_id,
                survey.date as survey_date,
                COALESCE(SUM(CASE WHEN sighting.species_id = :species_id THEN sighting.count ELSE 0 END), 0) as occurrence_count
            FROM survey
            LEFT JOIN sighting ON survey.id = sighting.survey_id AND sighting.species_id = :species_id
            WHERE survey.organisation_id = :org_id
            AND survey.status = 'completed'
            {survey_type_filter}
            {date_filter_sql}
            GROUP BY survey.id, survey.date
            ORDER BY survey.date, survey.id
        """)

        # Build parameters
        params: Dict[str, Any] = {"species_id": species_id, "org_id": org.id}
        if survey_type_id is not None:
            params['survey_type_id'] = survey_type_id
        add_date_params(params, start_date, end_date)

        result = db.execute(query, params)
        rows = result.fetchall()

        # Get species name
        species_query = text("""
            SELECT COALESCE(name, scientific_name) as display_name
            FROM species
            WHERE id = :species_id
        """)
        species_result = db.execute(species_query, {"species_id": species_id})
        species_row = species_result.fetchone()
        species_name = species_row.display_name if species_row else "Unknown Species"

        # Transform to response format
        data_points = [
            SpeciesOccurrenceDataPoint(
                survey_id=row.survey_id,
                survey_date=row.survey_date,
                occurrence_count=row.occurrence_count
            )
            for row in rows
        ]

        return SpeciesOccurrenceResponse(
            data=data_points,
            date_range=determine_date_range(data_points, start_date, end_date),
            species_name=species_name
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch species occurrences: {str(e)}"
        )


@router.get("/species-sightings", response_model=List[Dict[str, Any]])
async def get_species_sightings(
    species_id: int = Query(..., description="Species ID to get sightings for"),
    start_date: Optional[date] = Query(None, description="Filter from this date (inclusive)"),
    end_date: Optional[date] = Query(None, description="Filter until this date (inclusive)"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[Dict[str, Any]]:
    """
    Get all individual sighting locations for a specific species in the current organisation.

    Returns individual location points with coordinates, dates, and survey information.
    Each row represents one individual location point from a sighting.

    Args:
        species_id: ID of the species to get sightings for
        start_date: Optional start date filter
        end_date: Optional end date filter
        db: Database session

    Returns:
        List of individual locations with coordinates and date information
    """
    try:
        # Build date filters
        date_filter_sql = build_date_filter_sql(start_date, end_date)

        # Query to get all individual locations for sightings of this species
        query = text(f"""
            SELECT
                si.id,
                sighting.survey_id,
                sighting.species_id,
                survey.date as survey_date,
                ST_Y(si.coordinates) as latitude,
                ST_X(si.coordinates) as longitude,
                species.name as species_name,
                species.scientific_name as species_scientific_name,
                si.breeding_status_code,
                bsc.description as breeding_status_description,
                survey_type.id as survey_type_id,
                survey_type.name as survey_type_name,
                survey_type.icon as survey_type_icon,
                survey_type.color as survey_type_color
            FROM sighting_individual si
            JOIN sighting ON si.sighting_id = sighting.id
            JOIN survey ON sighting.survey_id = survey.id
            JOIN species ON sighting.species_id = species.id
            LEFT JOIN breeding_status_code bsc ON si.breeding_status_code = bsc.code
            LEFT JOIN survey_type ON survey.survey_type_id = survey_type.id
            WHERE sighting.species_id = :species_id
              AND survey.organisation_id = :org_id
            {date_filter_sql}
            ORDER BY survey.date, sighting.id, si.id
        """)

        # Build parameters
        params = {"species_id": species_id, "org_id": org.id}
        add_date_params(params, start_date, end_date)

        result = db.execute(query, params)
        rows = result.fetchall()

        # Transform to response format
        sightings = [
            {
                "id": row.id,
                "survey_id": row.survey_id,
                "species_id": row.species_id,
                "survey_date": row.survey_date.isoformat(),
                "latitude": row.latitude,
                "longitude": row.longitude,
                "species_name": row.species_name,
                "species_scientific_name": row.species_scientific_name,
                "breeding_status_code": row.breeding_status_code,
                "breeding_status_description": row.breeding_status_description,
                "survey_type_id": row.survey_type_id,
                "survey_type_name": row.survey_type_name,
                "survey_type_icon": row.survey_type_icon,
                "survey_type_color": row.survey_type_color
            }
            for row in rows
            if row.latitude is not None and row.longitude is not None  # Double check lat/lng exist
        ]

        return sightings

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch species sightings: {str(e)}"
        )
