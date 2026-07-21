"""Linking recorded surveys to scheduled-survey slots.

A survey records the slot whose window contains its date (same organisation
and survey type). Linking is non-destructive — it only ever sets or clears
``Survey.scheduled_survey_id`` — and idempotent, so it can be re-run on every
create or edit without harm. Fulfilment is derived (a slot with >=1 linked
survey), never stored.
"""

from typing import Optional

from sqlalchemy import case
from sqlalchemy.orm import Session
from sqlmodel import col

from models import ScheduledSurvey, ScheduledSurveyStatus, Survey


def link_is_valid(slot: Optional[ScheduledSurvey], survey: Survey) -> bool:
    """Whether ``survey`` can stay linked to ``slot``.

    Window containment governs. Slot status is deliberately not checked:
    cancelling a slot keeps its existing links (they are history) — it only
    stops new surveys linking to it, which `relink_survey` enforces.
    """
    return (
        slot is not None
        and slot.organisation_id == survey.organisation_id
        and slot.survey_type_id == survey.survey_type_id
        and slot.window_start <= survey.date <= slot.window_end
    )


def relink_survey(db: Session, survey: Survey) -> None:
    """(Re)compute ``survey.scheduled_survey_id``. Call after the survey's
    fields are set, before commit.

    A still-valid existing link is never churned. Otherwise the survey links
    to the open slot whose window contains its date, preferring slots at the
    survey's own location (or no location) over other locations' slots, then
    the earliest window, then the lowest id — a different-location slot is
    still linked as a last resort so the week never shows "needs survey" over
    a location mismatch.
    """
    if survey.scheduled_survey_id is not None:
        current = db.get(ScheduledSurvey, survey.scheduled_survey_id)
        if link_is_valid(current, survey):
            return

    survey.scheduled_survey_id = None
    if survey.survey_type_id is None:
        return

    location_preference = case(
        (col(ScheduledSurvey.location_id).is_(None), 0),
        (ScheduledSurvey.location_id == survey.location_id, 0),
        else_=1,
    )
    slot = (
        db.query(ScheduledSurvey)
        .filter(
            ScheduledSurvey.organisation_id == survey.organisation_id,
            ScheduledSurvey.survey_type_id == survey.survey_type_id,
            ScheduledSurvey.status == ScheduledSurveyStatus.open,
            col(ScheduledSurvey.window_start) <= survey.date,
            col(ScheduledSurvey.window_end) >= survey.date,
        )
        .order_by(location_preference, col(ScheduledSurvey.window_start), col(ScheduledSurvey.id))
        .first()
    )
    if slot is not None:
        survey.scheduled_survey_id = slot.id
