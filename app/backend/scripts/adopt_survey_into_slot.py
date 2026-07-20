#!/usr/bin/env python3
"""
Merge a completed survey into the scheduled slot it should have recorded:
the survey adopts the slot's scheduling window and the empty placeholder
slot is deleted (with its pre-assigned surveyor links).

Backfill companion to the auto-attach behaviour in POST /surveys — for
surveys that were entered via "new survey" before that existed and left
their week showing "needs survey".

Usage:
    ./run prod adopt_survey_into_slot.py <survey_id> <slot_id>
"""

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session

from database.connection import get_engine
from models import Sighting, Survey, SurveyStatus, SurveySurveyor

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)


def adopt(survey_id: int, slot_id: int) -> None:
    with Session(get_engine()) as db:
        survey = db.get(Survey, survey_id)
        slot = db.get(Survey, slot_id)

        if survey is None or slot is None:
            logger.error(f"Survey {survey_id} or slot {slot_id} not found")
            sys.exit(1)
        if survey.status != SurveyStatus.completed:
            logger.error(f"Survey {survey_id} is {survey.status}, expected completed")
            sys.exit(1)
        if slot.status != SurveyStatus.scheduled:
            logger.error(f"Slot {slot_id} is {slot.status}, expected scheduled")
            sys.exit(1)
        if slot.scheduled_window_start is None or slot.scheduled_window_end is None:
            logger.error(f"Slot {slot_id} has no scheduling window (day-precise?)")
            sys.exit(1)
        if (survey.organisation_id, survey.survey_type_id) != (slot.organisation_id, slot.survey_type_id):
            logger.error("Survey and slot differ in organisation or survey type")
            sys.exit(1)
        slot_sightings = db.query(Sighting).filter(Sighting.survey_id == slot.id).count()
        if slot_sightings:
            logger.error(f"Slot {slot_id} has {slot_sightings} sightings — refusing to delete")
            sys.exit(1)
        if not (slot.scheduled_window_start <= survey.date <= slot.scheduled_window_end):
            logger.warning(
                f"Note: survey date {survey.date} is outside the slot window "
                f"{slot.scheduled_window_start}..{slot.scheduled_window_end} — proceeding anyway"
            )

        logger.info(
            f"Survey {survey.id} (date={survey.date}) adopts window "
            f"{slot.scheduled_window_start}..{slot.scheduled_window_end} from slot {slot.id}"
        )
        survey.scheduled_window_start = slot.scheduled_window_start
        survey.scheduled_window_end = slot.scheduled_window_end
        deleted_links = db.query(SurveySurveyor).filter(
            SurveySurveyor.survey_id == slot.id
        ).delete()
        db.delete(slot)
        db.commit()
        logger.info(f"Deleted slot {slot.id} ({deleted_links} surveyor link(s)). Done.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        logger.error("Usage: adopt_survey_into_slot.py <survey_id> <slot_id>")
        sys.exit(1)
    adopt(int(sys.argv[1]), int(sys.argv[2]))
