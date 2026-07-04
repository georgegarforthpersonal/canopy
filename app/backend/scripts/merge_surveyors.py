#!/usr/bin/env python3
"""
Merge surveyors into others, moving their survey history.

The intended use: a volunteer with historical surveys (an unlinked
surveyor row) creates an account, which always gets a fresh linked
surveyor — sign-up never guesses at a match. This script performs the
deliberate merges: every survey attributed to a historical surveyor is
re-attributed to the account's surveyor, then the historical row is
deleted (or deactivated with --keep).

Edit MERGES below, then run. All pairs are validated before anything is
written, and applied in a single transaction — one bad pair aborts the
whole batch. Dry-run by default; pass --no-dry-run to apply.

Usage:
    ./run staging merge_surveyors.py
    ./run staging merge_surveyors.py --no-dry-run
    ./run staging merge_surveyors.py --no-dry-run --keep
"""

import argparse
import logging
import sys
from pathlib import Path

# ============================================================================
# EDIT ME: (from_id, to_id) pairs. from_id is the historical, unlinked
# surveyor to merge away; to_id inherits its surveys (usually the
# account-linked surveyor created when the person signed up).
# ============================================================================
MERGES: list[tuple[int, int]] = [
    # (2, 99),
]

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


def _validate(db: Session, from_id: int, to_id: int) -> tuple[Surveyor, Surveyor]:
    """One merge pair's preconditions; exits the whole run on any failure."""
    if from_id == to_id:
        logger.error(f"({from_id}, {to_id}): from and to are the same surveyor")
        sys.exit(1)
    source = db.get(Surveyor, from_id)
    target = db.get(Surveyor, to_id)
    if not source:
        logger.error(f"({from_id}, {to_id}): surveyor not found: {from_id}")
        sys.exit(1)
    if not target:
        logger.error(f"({from_id}, {to_id}): surveyor not found: {to_id}")
        sys.exit(1)
    if source.organisation_id != target.organisation_id:
        logger.error(f"({from_id}, {to_id}): surveyors belong to different organisations")
        sys.exit(1)
    if source.user_id is not None:
        # The source is some account's live surveyor; merging it away would
        # detach that account from its own history. The historical (unlinked)
        # row should always be the from side.
        logger.error(
            f"({from_id}, {to_id}): refusing — {_label(source)} is linked to an "
            "account. Merge the unlinked historical surveyor INTO the linked one."
        )
        sys.exit(1)
    return source, target


def merge_surveyors(keep: bool, dry_run: bool) -> None:
    if not MERGES:
        logger.error("MERGES is empty — edit the list at the top of this script")
        sys.exit(1)
    from_ids = [f for f, _ in MERGES]
    if len(set(from_ids)) != len(from_ids):
        logger.error("MERGES lists the same from_id twice")
        sys.exit(1)
    if set(from_ids) & {t for _, t in MERGES}:
        logger.error("MERGES uses an id as both from and to — chained merges are not supported")
        sys.exit(1)

    with Session(get_engine()) as db:
        # Validate every pair before writing anything.
        pairs = [_validate(db, f, t) for f, t in MERGES]

        for source, target in pairs:
            source_rows = db.query(SurveySurveyor).filter(
                SurveySurveyor.surveyor_id == source.id
            ).all()
            target_survey_ids = {
                sid for (sid,) in db.query(SurveySurveyor.survey_id).filter(
                    SurveySurveyor.surveyor_id == target.id
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
                continue
            for row in move:
                row.surveyor_id = target.id
                db.add(row)
            for row in drop:
                db.delete(row)
            if keep:
                source.is_active = False
                db.add(source)
            else:
                db.delete(source)

        if dry_run:
            logger.info("DRY RUN complete. Use --no-dry-run to apply.")
            return
        db.commit()
        logger.info(f"Merged {len(pairs)} surveyor(s).")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge the (historical, unlinked) surveyors listed in MERGES into their targets"
    )
    parser.add_argument("--keep", action="store_true",
                        help="Deactivate the historical surveyors instead of deleting them")
    parser.add_argument("--no-dry-run", action="store_true", help="Apply the changes")
    args = parser.parse_args()

    merge_surveyors(keep=args.keep, dry_run=not args.no_dry_run)


if __name__ == "__main__":
    main()
