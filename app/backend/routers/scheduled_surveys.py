"""
Scheduled Surveys Router - planned survey slots that recorded surveys link to

Endpoints:
  GET    /api/scheduled-surveys               - List slots (with linked surveys embedded)
  POST   /api/scheduled-surveys/schedule      - Bulk-create a recurring series of slots
  GET    /api/scheduled-surveys/{id}          - Get a specific slot
  PUT    /api/scheduled-surveys/{id}          - Update a slot (cancel = {"status": "cancelled"})
  DELETE /api/scheduled-surveys/{id}          - Delete a slot (linked surveys are detached, never deleted)
  POST   /api/scheduled-surveys/{id}/signup   - Sign yourself up to a slot
  DELETE /api/scheduled-surveys/{id}/signup   - Withdraw yourself from a slot

A slot is a plan; a Survey row is a recorded event pointing at it via
``scheduled_survey_id``. Fulfilment is derived (>=1 linked survey), not stored.
"""

from fastapi import APIRouter, HTTPException, status, Depends, Query
from typing import List, Optional, Any
from datetime import timedelta
from sqlalchemy.orm import Session
from sqlmodel import col
from database.connection import get_db
from auth import Principal, require_editor, require_user
from dependencies import get_current_organisation
from models import (
    ScheduledSurvey, ScheduledSurveyCreate, ScheduledSurveyUpdate, ScheduledSurveyRead,
    ScheduledSurveyStatus, ScheduledSurveySurveyor, ScheduleCadence,
    Survey, SurveyType, Location, Surveyor, Organisation,
)
from services.accounts import ensure_linked_surveyor

router = APIRouter()


def _location_names(db: Session, slots: List[ScheduledSurvey]) -> dict[int, str]:
    """Display names for the slots' locations; a sector location is
    displayed as "<parent> - child"."""
    location_ids = {s.location_id for s in slots if s.location_id is not None}
    if not location_ids:
        return {}
    locations = db.query(Location).filter(col(Location.id).in_(location_ids)).all()
    parent_ids = {loc.parent_location_id for loc in locations if loc.parent_location_id is not None}
    parents = {
        p.id: p.name
        for p in db.query(Location).filter(col(Location.id).in_(parent_ids)).all()
    } if parent_ids else {}
    names: dict[int, str] = {}
    for loc in locations:
        if loc.id is None:
            continue
        parent_name = parents.get(loc.parent_location_id) if loc.parent_location_id else None
        names[loc.id] = f"{parent_name} - {loc.name}" if parent_name else loc.name
    return names


def _serialize_slots(db: Session, slots: List[ScheduledSurvey]) -> List[dict[str, Any]]:
    """Slots with surveyor pre-assignments and linked-survey summaries, batch-loaded."""
    slot_ids = [s.id for s in slots if s.id is not None]

    surveyor_ids_map: dict[int, list[int]] = {sid: [] for sid in slot_ids}
    if slot_ids:
        for row in (
            db.query(ScheduledSurveySurveyor.scheduled_survey_id, ScheduledSurveySurveyor.surveyor_id)
            .filter(col(ScheduledSurveySurveyor.scheduled_survey_id).in_(slot_ids))
            .order_by(ScheduledSurveySurveyor.scheduled_survey_id, ScheduledSurveySurveyor.surveyor_id)
            .all()
        ):
            surveyor_ids_map[row.scheduled_survey_id].append(row.surveyor_id)

    linked_map: dict[int, list[dict[str, Any]]] = {sid: [] for sid in slot_ids}
    if slot_ids:
        for row in (
            db.query(Survey.id, Survey.date, Survey.scheduled_survey_id)
            .filter(col(Survey.scheduled_survey_id).in_(slot_ids))
            .order_by(col(Survey.date), col(Survey.id))
            .all()
        ):
            linked_map[row.scheduled_survey_id].append({"id": row.id, "date": row.date})

    location_names = _location_names(db, slots)

    return [
        {
            "id": s.id,
            "survey_type_id": s.survey_type_id,
            "location_id": s.location_id,
            "location_name": location_names.get(s.location_id) if s.location_id else None,
            "window_start": s.window_start,
            "window_end": s.window_end,
            "notes": s.notes,
            "status": s.status,
            "surveyor_ids": surveyor_ids_map.get(s.id, []) if s.id else [],
            "linked_surveys": linked_map.get(s.id, []) if s.id else [],
            "created_at": s.created_at,
        }
        for s in slots
    ]


@router.get("", response_model=List[ScheduledSurveyRead])
async def get_scheduled_surveys(
    survey_type_id: Optional[int] = Query(None, description="Filter by survey type ID"),
    slot_status: Optional[ScheduledSurveyStatus] = Query(None, alias="status", description="Filter by slot status"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[dict[str, Any]]:
    """
    List the organisation's scheduled surveys with linked recorded surveys
    embedded (a slot with any linked survey is fulfilled).

    Unpaginated: a series is at most 104 slots, and clients need the full
    worklist to split overdue/current/upcoming correctly.
    """
    query = db.query(ScheduledSurvey).filter(ScheduledSurvey.organisation_id == org.id)
    if survey_type_id:
        query = query.filter(ScheduledSurvey.survey_type_id == survey_type_id)
    if slot_status:
        query = query.filter(ScheduledSurvey.status == slot_status)
    slots = query.order_by(col(ScheduledSurvey.window_start), col(ScheduledSurvey.id)).all()
    return _serialize_slots(db, slots)


@router.post(
    "/schedule",
    response_model=List[ScheduledSurveyRead],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_editor)],
)
async def schedule_surveys(
    schedule: ScheduledSurveyCreate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> List[dict[str, Any]]:
    """
    Bulk-create a recurring series of slots, one per date, sharing the same
    survey type, location and pre-assigned surveyors, in a single transaction.

    The survey type's ``schedule_cadence`` decides how each date is
    interpreted: a 'date' type plans a specific day (window is that one day),
    a 'weekly' type plans the whole week beginning on that date.
    """
    # The cadence is a property of the survey type; look it up once. Outside
    # the try block so the 404 isn't rewrapped as a 500.
    survey_type = db.query(SurveyType).filter(
        SurveyType.id == schedule.survey_type_id,
        SurveyType.organisation_id == org.id,
    ).first()
    if survey_type is None:
        raise HTTPException(status_code=404, detail="Survey type not found")

    try:
        created: list[ScheduledSurvey] = []
        for slot_date in schedule.dates:
            window_end = (
                slot_date + timedelta(days=6)
                if survey_type.schedule_cadence == ScheduleCadence.weekly
                else slot_date
            )
            slot = ScheduledSurvey(
                organisation_id=org.id,
                survey_type_id=schedule.survey_type_id,
                location_id=schedule.location_id,
                window_start=slot_date,
                window_end=window_end,
                notes=schedule.notes,
            )
            db.add(slot)
            db.flush()  # Get the ID without committing

            for surveyor_id in schedule.surveyor_ids:
                db.add(ScheduledSurveySurveyor(scheduled_survey_id=slot.id, surveyor_id=surveyor_id))

            created.append(slot)

        db.commit()
        return _serialize_slots(db, created)

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to schedule surveys: {str(e)}")


def _get_slot(db: Session, scheduled_survey_id: int, org_id: int) -> ScheduledSurvey:
    slot = db.query(ScheduledSurvey).filter(
        ScheduledSurvey.id == scheduled_survey_id,
        ScheduledSurvey.organisation_id == org_id,
    ).first()
    if not slot:
        raise HTTPException(status_code=404, detail=f"Scheduled survey {scheduled_survey_id} not found")
    return slot  # type: ignore[no-any-return]


@router.get("/{scheduled_survey_id}", response_model=ScheduledSurveyRead)
async def get_scheduled_survey(
    scheduled_survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Get a specific slot (used by the record flow to prefill a new survey)."""
    slot = _get_slot(db, scheduled_survey_id, org.id)  # type: ignore[arg-type]
    return _serialize_slots(db, [slot])[0]


@router.put("/{scheduled_survey_id}", response_model=ScheduledSurveyRead, dependencies=[Depends(require_editor)])
async def update_scheduled_survey(
    scheduled_survey_id: int,
    update: ScheduledSurveyUpdate,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """
    Update a slot. Cancelling ({"status": "cancelled"}) keeps any linked
    surveys — it only stops new surveys linking to the slot.
    """
    slot = _get_slot(db, scheduled_survey_id, org.id)  # type: ignore[arg-type]

    update_data = update.model_dump(exclude_unset=True, exclude={'surveyor_ids'})
    for field, value in update_data.items():
        setattr(slot, field, value)

    if update.surveyor_ids is not None:
        db.query(ScheduledSurveySurveyor).filter(
            ScheduledSurveySurveyor.scheduled_survey_id == scheduled_survey_id
        ).delete()
        for surveyor_id in update.surveyor_ids:
            db.add(ScheduledSurveySurveyor(scheduled_survey_id=scheduled_survey_id, surveyor_id=surveyor_id))

    db.commit()
    db.refresh(slot)
    return _serialize_slots(db, [slot])[0]


@router.delete("/{scheduled_survey_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_editor)])
async def delete_scheduled_survey(
    scheduled_survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db)
) -> None:
    """Delete a slot. Linked recorded surveys are detached (FK set to null),
    never deleted."""
    slot = _get_slot(db, scheduled_survey_id, org.id)  # type: ignore[arg-type]
    db.delete(slot)
    db.commit()
    return None


def _get_open_slot_for_signup(db: Session, scheduled_survey_id: int, org_id: int) -> ScheduledSurvey:
    slot = _get_slot(db, scheduled_survey_id, org_id)
    if slot.status != ScheduledSurveyStatus.open:
        raise HTTPException(status_code=400, detail="You can only sign up to open scheduled surveys")
    return slot


def _get_or_create_own_surveyor(db: Session, principal: Principal, org_id: int) -> Surveyor:
    """The surveyor linked to the caller's account.

    Normally created at registration (accept-invite); this is a safety net
    for accounts that predate that, e.g. bootstrap admins or backfilled users.
    """
    surveyor = ensure_linked_surveyor(db, principal.user, org_id)
    db.commit()
    db.refresh(surveyor)
    return surveyor


def _slot_surveyor_ids(db: Session, scheduled_survey_id: int) -> list[int]:
    return [
        sid for (sid,) in db.query(ScheduledSurveySurveyor.surveyor_id)
        .filter(ScheduledSurveySurveyor.scheduled_survey_id == scheduled_survey_id)
        .order_by(ScheduledSurveySurveyor.surveyor_id).all()
    ]


@router.post("/{scheduled_survey_id}/signup")
async def sign_up_to_scheduled_survey(
    scheduled_survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_user),
) -> dict[str, Any]:
    """
    Add *yourself* to a slot (any role, including viewers).

    Unlike PUT, this can only touch the caller's own membership: it adds the
    surveyor linked to their account (created on first use), leaving
    everything else about the slot unchanged.
    """
    slot = _get_open_slot_for_signup(db, scheduled_survey_id, org.id)  # type: ignore[arg-type]
    surveyor = _get_or_create_own_surveyor(db, principal, org.id)  # type: ignore[arg-type]

    already = db.query(ScheduledSurveySurveyor).filter(
        ScheduledSurveySurveyor.scheduled_survey_id == slot.id,
        ScheduledSurveySurveyor.surveyor_id == surveyor.id,
    ).first()
    if not already:
        db.add(ScheduledSurveySurveyor(scheduled_survey_id=slot.id, surveyor_id=surveyor.id))
        db.commit()

    assert slot.id is not None
    return {
        "scheduled_survey_id": slot.id,
        "surveyor_id": surveyor.id,
        "surveyor_ids": _slot_surveyor_ids(db, slot.id),
    }


@router.delete("/{scheduled_survey_id}/signup")
async def withdraw_from_scheduled_survey(
    scheduled_survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_user),
) -> dict[str, Any]:
    """Remove *yourself* from a slot you signed up to."""
    slot = _get_open_slot_for_signup(db, scheduled_survey_id, org.id)  # type: ignore[arg-type]

    surveyor = db.query(Surveyor).filter(Surveyor.user_id == principal.user_id).first()
    if surveyor:
        db.query(ScheduledSurveySurveyor).filter(
            ScheduledSurveySurveyor.scheduled_survey_id == slot.id,
            ScheduledSurveySurveyor.surveyor_id == surveyor.id,
        ).delete()
        db.commit()

    assert slot.id is not None
    return {
        "scheduled_survey_id": slot.id,
        "surveyor_id": surveyor.id if surveyor else None,
        "surveyor_ids": _slot_surveyor_ids(db, slot.id),
    }
