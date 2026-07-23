"""
Set survey type icon slugs for the Canopy badge icon set (July 2026).

The frontend maps `SurveyType.icon` slugs to badge SVGs in
src/config/canopyIcons.ts; types whose icon is unset (or unknown) fall back
to the species-glyph tile. This script assigns slugs by survey type name,
case-insensitively, across every organisation — the mapping is product-level,
not org-specific. Types with no matching pattern are left untouched.

Safe to re-run: already-correct icons are skipped.

Usage:
    ./run staging set_survey_type_icons.py                     # dry-run (preview)
    ./run staging set_survey_type_icons.py --no-dry-run --yes  # apply
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

# Ordered (pattern, slug) pairs — first match wins, so the more specific
# names come before the generic ones (e.g. Marsh Fritillary before Butterfly).
NAME_TO_ICON: list[tuple[str, str]] = [
    ("marsh fritillary", "marsh-fritillary"),
    ("turtledove", "turtle-dove"),
    ("turtle dove", "turtle-dove"),
    # Heal's "Jenny" insect survey type — jenny wren, hence the wren badge.
    ("jenny", "wren"),
    ("wren", "wren"),
    ("butterfly", "butterfly"),
    ("bird", "generic-bird"),
    ("walking", "generic-bird"),
    ("audio", "audio"),
    ("camera trap", "camera-trap"),
    ("ad hoc", "ad-hoc"),
    ("ad-hoc", "ad-hoc"),
    ("reptile", "reptile-snake"),
    ("dragonfly", "dragonfly"),
]


def icon_for(name: str) -> str | None:
    normalised = name.strip().lower()
    for pattern, slug in NAME_TO_ICON:
        if pattern in normalised:
            return slug
    return None


def main() -> None:
    parser = get_arg_parser(description=__doc__)
    parser.add_argument('--yes', '-y', action='store_true', help='Skip confirmation prompt')
    args = parser.parse_args()

    logger.info(f"{'DRY RUN — no changes will be committed' if args.dry_run else 'LIVE RUN'}\n")

    with Session(get_engine()) as db:
        changed = 0
        for org in db.query(Organisation).order_by(Organisation.id).all():
            types = db.query(SurveyType).filter(SurveyType.organisation_id == org.id).order_by(SurveyType.id).all()
            for t in types:
                slug = icon_for(t.name)
                if slug is None:
                    logger.info(f"{org.slug}: {t.name!r} (id={t.id}) — no matching icon, leaving {t.icon!r}")
                    continue
                if t.icon == slug:
                    logger.info(f"{org.slug}: {t.name!r} (id={t.id}) — already {slug!r}")
                    continue
                logger.info(f"{org.slug}: {t.name!r} (id={t.id}) — {t.icon!r} -> {slug!r}")
                t.icon = slug
                changed += 1

        logger.info(f"\n{changed} survey type(s) to update.")

        if args.dry_run:
            db.rollback()
            logger.info("DRY RUN complete — rolled back. Re-run with --no-dry-run to apply.")
            return

        if changed and not args.yes:
            response = input("\nApply all changes? [y/N]: ")
            if response.lower() != 'y':
                db.rollback()
                logger.info("Aborted.")
                return

        db.commit()
        logger.info("Done.")


if __name__ == "__main__":
    main()
