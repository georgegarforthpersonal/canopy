"""
Rename Cannwood's "Turtledove" survey type to "Turtle Dove" (July 2026).

The one-word name was a hasty choice during the survey rejig; the species is
"Turtle Dove" and the group card should match. The Groups beta gate matches
both spellings, and the type's icon slug is stored, so nothing else moves.

Safe to re-run: skips when the type is already named "Turtle Dove".

Usage:
    ./run staging rename_turtledove.py                     # dry-run (preview)
    ./run staging rename_turtledove.py --no-dry-run --yes  # apply
"""

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session

from database.connection import get_engine
from models import Organisation, SurveyType
from script_utils import get_arg_parser

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)


def main() -> None:
    parser = get_arg_parser(description=__doc__)
    parser.add_argument('--yes', '-y', action='store_true', help='Skip confirmation prompt')
    args = parser.parse_args()

    logger.info(f"{'DRY RUN — no changes will be committed' if args.dry_run else 'LIVE RUN'}\n")

    with Session(get_engine()) as db:
        org = db.query(Organisation).filter(Organisation.slug == 'cannwood').one_or_none()
        if org is None:
            logger.error("No organisation with slug 'cannwood'")
            sys.exit(1)

        types = db.query(SurveyType).filter(
            SurveyType.organisation_id == org.id,
            SurveyType.name.ilike('turtle%dove'),
        ).all()
        if len(types) != 1:
            logger.error(f"Expected exactly one turtledove-ish type, found {[t.name for t in types]}")
            sys.exit(1)

        t = types[0]
        if t.name == 'Turtle Dove':
            logger.info(f"Survey type {t.id} already named 'Turtle Dove' — nothing to do.")
            return
        logger.info(f"Rename: survey type {t.id} {t.name!r} -> 'Turtle Dove'")
        t.name = 'Turtle Dove'

        if args.dry_run:
            db.rollback()
            logger.info("\nDRY RUN complete — rolled back. Re-run with --no-dry-run to apply.")
            return

        if not args.yes:
            response = input("\nApply? [y/N]: ")
            if response.lower() != 'y':
                db.rollback()
                logger.info("Aborted.")
                return

        db.commit()
        logger.info("Done.")


if __name__ == "__main__":
    main()
