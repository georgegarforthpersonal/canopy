#!/usr/bin/env python3
"""
Merge one surveyor into another, moving their survey history.

The intended use: a volunteer with historical surveys (an unlinked
surveyor row) creates an account, which always gets a fresh linked
surveyor — sign-up never guesses at a match. This script performs the
deliberate merge: every survey attributed to the historical surveyor is
re-attributed to the account's surveyor, then the historical row is
deleted (or deactivated with --keep).

Dry-run by default; pass --no-dry-run to apply.

Usage:
    ./run staging merge_surveyors.py --from 2 --to 99
    ./run staging merge_surveyors.py --from 2 --to 99 --no-dry-run
    ./run staging merge_surveyors.py --from 2 --to 99 --no-dry-run --keep
"""

import argparse
import logging
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session

from database.connection import get_engine
from models import Surveyor, SurveySurveyor

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


def _label(s: Surveyor) -> str:
    name = f"{s.first_name} {s.last_name}" if s.last_name else s.first_name
    linked = f"linked to user {s.user_id}" if s.user_id else "unlinked"
    return f"{name} (id={s.id}, {linked})"


def merge_surveyors(from_id: int, to_id: int, keep: bool, dry_run: bool) -> None:
    if from_id == to_id:
        logger.error("--from and --to are the same surveyor")
        sys.exit(1)

    with Session(get_engine()) as db:
        source = db.get(Surveyor, from_id)
        target = db.get(Surveyor, to_id)
        if not source:
            logger.error(f"Surveyor not found: {from_id}")
            sys.exit(1)
        if not target:
            logger.error(f"Surveyor not found: {to_id}")
            sys.exit(1)
        if source.organisation_id != target.organisation_id:
            logger.error("Surveyors belong to different organisations")
            sys.exit(1)
        if source.user_id is not None:
            # The source is some account's live surveyor; merging it away
            # would detach that account from its own history. The historical
            # (unlinked) row should always be the --from side.
            logger.error(
                f"Refusing: {_label(source)} is linked to an account. "
                "Merge the unlinked historical surveyor INTO the linked one."
            )
            sys.exit(1)

        source_rows = db.query(SurveySurveyor).filter(
            SurveySurveyor.surveyor_id == from_id
        ).all()
        target_survey_ids = {
            sid for (sid,) in db.query(SurveySurveyor.survey_id).filter(
                SurveySurveyor.surveyor_id == to_id
            )
        }
        # Surveys that already list both people just drop the source row;
        # everything else is repointed at the target.
        drop = [r for r in source_rows if r.survey_id in target_survey_ids]
        move = [r for r in source_rows if r.survey_id not in target_survey_ids]

        logger.info(f"Merging {_label(source)} -> {_label(target)}")
        logger.info(f"  {len(move)} survey(s) re-attributed")
        if drop:
            logger.info(f"  {len(drop)} survey(s) already list both — duplicate rows removed")
        logger.info(
            f"  historical surveyor will be {'deactivated' if keep else 'deleted'}"
        )

        if dry_run:
            logger.info("DRY RUN complete. Use --no-dry-run to apply.")
            return

        for row in move:
            row.surveyor_id = to_id
            db.add(row)
        for row in drop:
            db.delete(row)
        if keep:
            source.is_active = False
            db.add(source)
        else:
            db.delete(source)
        db.commit()
        logger.info("Merge complete.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge a (historical, unlinked) surveyor into another, moving survey history"
    )
    parser.add_argument("--from", dest="from_id", type=int, required=True,
                        help="Surveyor id to merge away (the historical, unlinked one)")
    parser.add_argument("--to", dest="to_id", type=int, required=True,
                        help="Surveyor id that inherits the surveys (usually the account-linked one)")
    parser.add_argument("--keep", action="store_true",
                        help="Deactivate the historical surveyor instead of deleting it")
    parser.add_argument("--no-dry-run", action="store_true", help="Apply the changes")
    args = parser.parse_args()

    merge_surveyors(args.from_id, args.to_id, keep=args.keep, dry_run=not args.no_dry_run)


if __name__ == "__main__":
    main()
