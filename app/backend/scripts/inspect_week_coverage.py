#!/usr/bin/env python3
"""
Read-only diagnostic: dump every scheduled-survey slot and recorded survey for
an organisation in a date range, with type, window, status, surveyors and
links — enough to see why a week shows as "no survey recorded" in the Groups
overview.

Usage:
    ./run prod inspect_week_coverage.py heal 2026-07-01 2026-07-20
"""

import logging
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import func
from sqlalchemy.orm import Session

from database.connection import get_engine
from models import (
    Organisation, ScheduledSurvey, ScheduledSurveySurveyor,
    Survey, Surveyor, SurveySurveyor, SurveyType,
)

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)


def _names(db: Session, surveyor_ids: list[int]) -> list[str]:
    if not surveyor_ids:
        return []
    return [
        f"{sv.first_name} {sv.last_name or ''}".strip()
        for sv in db.query(Surveyor).filter(Surveyor.id.in_(surveyor_ids)).all()
    ]


def inspect(org_fragment: str, start: date, end: date) -> None:
    with Session(get_engine()) as db:
        org = db.query(Organisation).filter(
            func.lower(Organisation.slug).like(f"%{org_fragment.lower()}%")
        ).first()
        if not org:
            logger.error(f"No organisation matching '{org_fragment}'")
            return
        logger.info(f"=== Organisation: id={org.id} slug={org.slug} name={org.name} ===\n")

        types = {
            t.id: t for t in db.query(SurveyType).filter(
                SurveyType.organisation_id == org.id
            ).all()
        }
        logger.info(f"=== Survey types ({len(types)}) ===")
        for t in types.values():
            logger.info(f"  id={t.id}  '{t.name}'")

        slots = db.query(ScheduledSurvey).filter(
            ScheduledSurvey.organisation_id == org.id,
            ScheduledSurvey.window_end >= start,
            ScheduledSurvey.window_start <= end,
        ).order_by(ScheduledSurvey.window_start, ScheduledSurvey.id).all()

        logger.info(f"\n=== Scheduled slots overlapping {start} .. {end} ({len(slots)}) ===")
        for slot in slots:
            pre_ids = [
                sid for (sid,) in db.query(ScheduledSurveySurveyor.surveyor_id).filter(
                    ScheduledSurveySurveyor.scheduled_survey_id == slot.id
                ).all()
            ]
            linked = [
                (s.id, s.date) for s in db.query(Survey).filter(
                    Survey.scheduled_survey_id == slot.id
                ).order_by(Survey.date, Survey.id).all()
            ]
            tname = types[slot.survey_type_id].name if slot.survey_type_id in types else slot.survey_type_id
            logger.info(
                f"  slot id={slot.id}  window={slot.window_start}..{slot.window_end}  "
                f"status={slot.status}  type='{tname}'  location_id={slot.location_id}  "
                f"created={slot.created_at}  pre-assigned={_names(db, pre_ids) or 'none'}  "
                f"linked_surveys={linked or 'NONE (unfulfilled)'}"
            )

        surveys = db.query(Survey).filter(
            Survey.organisation_id == org.id,
            Survey.date >= start,
            Survey.date <= end,
        ).order_by(Survey.date, Survey.id).all()

        logger.info(f"\n=== Recorded surveys {start} .. {end} ({len(surveys)}) ===")
        for s in surveys:
            ids = [
                sid for (sid,) in db.query(SurveySurveyor.surveyor_id).filter(
                    SurveySurveyor.survey_id == s.id
                ).all()
            ]
            tname = types[s.survey_type_id].name if s.survey_type_id in types else s.survey_type_id
            logger.info(
                f"  id={s.id}  date={s.date}  type='{tname}'  "
                f"scheduled_survey_id={s.scheduled_survey_id}  location_id={s.location_id}  "
                f"created={s.created_at}  surveyors={_names(db, ids) or 'none'}"
            )


if __name__ == "__main__":
    if len(sys.argv) < 4:
        logger.error("Usage: inspect_week_coverage.py <org fragment> <start YYYY-MM-DD> <end YYYY-MM-DD>")
        sys.exit(1)
    inspect(sys.argv[1], date.fromisoformat(sys.argv[2]), date.fromisoformat(sys.argv[3]))
