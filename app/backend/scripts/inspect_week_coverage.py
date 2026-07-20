#!/usr/bin/env python3
"""
Read-only diagnostic: dump every survey (any status) for an organisation in a
date range, with type, status, scheduling window, surveyors and creation time —
enough to see why a week shows as "no survey recorded" in the Groups overview.

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
from models import Organisation, Survey, Surveyor, SurveySurveyor, SurveyType

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)


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

        surveys = db.query(Survey).filter(
            Survey.organisation_id == org.id,
            Survey.date >= start,
            Survey.date <= end,
        ).order_by(Survey.date, Survey.id).all()

        logger.info(f"\n=== Surveys {start} .. {end} ({len(surveys)}) ===")
        for s in surveys:
            names = [
                f"{sv.first_name} {sv.last_name or ''}".strip()
                for sv in db.query(Surveyor).join(
                    SurveySurveyor, SurveySurveyor.surveyor_id == Surveyor.id
                ).filter(SurveySurveyor.survey_id == s.id).all()
            ]
            window = (
                f"window={s.scheduled_window_start}..{s.scheduled_window_end}"
                if s.scheduled_window_start or s.scheduled_window_end
                else "window=none"
            )
            tname = types[s.survey_type_id].name if s.survey_type_id in types else s.survey_type_id
            logger.info(
                f"  id={s.id}  date={s.date}  status={s.status}  type='{tname}'  "
                f"{window}  location_id={s.location_id}  created={s.created_at}  "
                f"surveyors={names or 'none'}"
            )


if __name__ == "__main__":
    if len(sys.argv) < 4:
        logger.error("Usage: inspect_week_coverage.py <org fragment> <start YYYY-MM-DD> <end YYYY-MM-DD>")
        sys.exit(1)
    inspect(sys.argv[1], date.fromisoformat(sys.argv[2]), date.fromisoformat(sys.argv[3]))
