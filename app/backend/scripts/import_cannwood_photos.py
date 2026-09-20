"""
Attach the Cannwood annual monitoring report photo plates to their surveys.

The reports (2020-2026) carry pages of photographs. The plates document the
estate's condition over the year's visits, so they hang off a survey rather
than off any sighting: all of a year's plates go to the FIRST Plant survey
of that year (George's call, 20 Sep 2026 — matching each plate to its
specific parcel is not reliably automatable and doesn't matter for browsing).
They are stored as camera_trap_image rows hanging off survey_id and shown by
the survey-level photo gallery, which this script also switches on for the
Plant survey type (allow_survey_photos).

Only actual photographs are attached: at least MIN_PHOTO_BYTES and a JPEG
(the Ordnance Survey plans in these reports are exported as PNG, the page
furniture and logos are tiny).

Photos are expected under --photos-dir, which must be inside the container
(only app/backend is mounted):

    scripts/data/cannwood_photos/
        2020/p17_0.jpg ...   # p<plate page>_<index on the page>

Idempotent: each plate is uploaded under a stable derived filename, and a
plate already present anywhere in the organisation is skipped, so re-running
adds nothing — including plates an earlier version of this script attached
to their specific parcel surveys.

Usage:
    ./run staging import_cannwood_photos.py                       # dry run
    ./run staging import_cannwood_photos.py --no-dry-run --yes    # apply
"""

import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session

from database.connection import get_engine
from models import (
    CameraTrapImage,
    Organisation,
    ProcessingStatus,
    Survey,
    SurveyType,
)
from script_utils import get_arg_parser
from services.r2_storage import upload_image_file

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

DEFAULT_PHOTOS_DIR = Path(__file__).parent / "data" / "cannwood_photos"

SURVEY_TYPE_NAME = "Plant"

#: Anything smaller is page furniture, not a photograph: the repeated FCLS
#: logo is ~7.7KB and the cover-page decorations are a few tens of KB.
MIN_PHOTO_BYTES = 40 * 1024

#: The plans and maps in these reports are PNG exports; photographs are JPEG.
PHOTO_SUFFIXES = {".jpg", ".jpeg"}

PLATE_FILE_RE = re.compile(r"^p(\d{2,3})_(\d+)\.(jpg|jpeg|png)$", re.I)


def find_org(db: Session, slug: str) -> Organisation:
    org = db.query(Organisation).filter(Organisation.slug == slug).one_or_none()
    if not org:
        logger.error(f"No organisation with slug {slug!r}")
        sys.exit(1)
    return org


def find_survey_type(db: Session, org: Organisation) -> SurveyType:
    survey_type = db.query(SurveyType).filter(
        SurveyType.organisation_id == org.id,
        SurveyType.name == SURVEY_TYPE_NAME,
    ).one_or_none()
    if not survey_type:
        logger.error(
            f"No {SURVEY_TYPE_NAME!r} survey type in {org.name!r}; "
            "run import_cannwood_botanical.py first."
        )
        sys.exit(1)
    return survey_type


def first_survey_of_year(
    db: Session, org: Organisation, survey_type: SurveyType, year: int
) -> Survey | None:
    """The year's earliest Plant survey (ties broken by id, for stability)."""
    surveys = db.query(Survey).filter(
        Survey.organisation_id == org.id,
        Survey.survey_type_id == survey_type.id,
    ).all()
    matching = [s for s in surveys if s.date and s.date.year == year]
    return min(matching, key=lambda s: (s.date, s.id)) if matching else None


def enable_survey_photos(db: Session, survey_type: SurveyType, stats: dict) -> None:
    if not survey_type.allow_survey_photos:
        survey_type.allow_survey_photos = True
        stats["survey_type_flag_set"] += 1
        logger.info(f"Enabled allow_survey_photos on {SURVEY_TYPE_NAME!r}")


def plate_filename(year: str, page: int, index: str, suffix: str) -> str:
    """Stable across runs and unique across years, so it doubles as the idempotency key."""
    return f"cannwood-{year}-p{page:02d}-{index}{suffix.lower()}"


def already_in_org(db: Session, org: Organisation, filename: str) -> Survey | None:
    """The survey already holding this plate, wherever an earlier run put it."""
    row = (
        db.query(Survey)
        .join(CameraTrapImage, CameraTrapImage.survey_id == Survey.id)
        .filter(Survey.organisation_id == org.id, CameraTrapImage.filename == filename)
        .first()
    )
    return row


def import_photos(
    db: Session, org: Organisation, survey_type: SurveyType,
    photos_dir: Path, dry_run: bool, stats: dict,
) -> None:
    for year_dir in sorted(p for p in photos_dir.iterdir() if p.is_dir()):
        year = year_dir.name
        if not year.isdigit():
            continue
        logger.info(f"\n{year}:")

        survey = first_survey_of_year(db, org, survey_type, int(year))
        if not survey:
            count = sum(1 for p in year_dir.iterdir() if PLATE_FILE_RE.match(p.name))
            stats["skipped_no_survey"] += count
            logger.info(f"  skipped {count} file(s), no {SURVEY_TYPE_NAME} survey in {year}")
            continue

        for path in sorted(year_dir.iterdir()):
            match = PLATE_FILE_RE.match(path.name)
            if not match:
                continue
            plate_page, index = int(match.group(1)), match.group(2)

            if path.suffix.lower() not in PHOTO_SUFFIXES:
                stats["skipped_not_a_photo"] += 1
                logger.info(f"  p{plate_page:02d} {path.name}: skipped, a plan or map (not JPEG)")
                continue
            if path.stat().st_size < MIN_PHOTO_BYTES:
                stats["skipped_too_small"] += 1
                logger.info(
                    f"  p{plate_page:02d} {path.name}: skipped, "
                    f"{path.stat().st_size // 1024}KB is page furniture, not a photo"
                )
                continue

            filename = plate_filename(year, plate_page, index, path.suffix)
            existing_on = already_in_org(db, org, filename)
            if existing_on:
                stats["already_attached"] += 1
                logger.info(
                    f"  p{plate_page:02d} {filename}: already attached "
                    f"(survey {existing_on.id}), skipping"
                )
                continue

            size = path.stat().st_size
            if dry_run:
                stats["would_attach"] += 1
                logger.info(
                    f"  p{plate_page:02d} {filename}: would attach to survey {survey.id} "
                    f"({survey.date}), {size // 1024}KB"
                )
                continue

            with open(path, "rb") as handle:
                r2_key = upload_image_file(
                    handle, f"survey_{survey.id}/{filename}", org.slug, "image/jpeg"
                )
            db.add(CameraTrapImage(
                survey_id=survey.id,
                filename=filename,
                r2_key=r2_key,
                file_size_bytes=size,
                # Nothing to infer on a scanned plate: completed keeps the
                # dispatcher from ever picking it up.
                processing_status=ProcessingStatus.completed,
            ))
            stats["attached"] += 1
            logger.info(
                f"  p{plate_page:02d} {filename}: attached to survey {survey.id} ({survey.date})"
            )


def main() -> None:
    parser = get_arg_parser(description=__doc__)
    parser.add_argument("--org-slug", default="cannwood", help="Organisation slug (default: cannwood)")
    parser.add_argument(
        "--photos-dir", default=str(DEFAULT_PHOTOS_DIR),
        help="Directory holding the per-year plate folders",
    )
    parser.add_argument("--yes", "-y", action="store_true", help="Apply without interactive confirmation")
    args = parser.parse_args()

    photos_dir = Path(args.photos_dir)
    if not photos_dir.is_dir():
        logger.error(f"No such directory: {photos_dir}")
        sys.exit(1)

    stats = {
        "survey_type_flag_set": 0, "attached": 0, "would_attach": 0,
        "already_attached": 0, "skipped_not_a_photo": 0, "skipped_too_small": 0,
        "skipped_no_survey": 0,
    }

    with Session(get_engine()) as db:
        org = find_org(db, args.org_slug)
        logger.info(f"Attaching report plates in organisation {org.name!r} (id {org.id})")

        survey_type = find_survey_type(db, org)
        enable_survey_photos(db, survey_type, stats)

        # Confirm BEFORE importing: plates upload to R2 as they go, and object
        # storage takes no part in the transaction, so aborting afterwards
        # would roll back the rows and strand the uploaded objects.
        if not args.dry_run and not args.yes:
            confirm = input("\nUpload the plates and attach them? [y/N] ")
            if confirm.strip().lower() != "y":
                db.rollback()
                logger.info("Aborted, nothing uploaded.")
                return

        import_photos(db, org, survey_type, photos_dir, args.dry_run, stats)

        logger.info("")
        for key, value in stats.items():
            logger.info(f"  {key}: {value}")

        if args.dry_run:
            db.rollback()
            logger.info("\nDRY RUN complete, rolled back. Re-run with --no-dry-run to apply.")
            return
        db.commit()
        logger.info("\nImport committed.")


if __name__ == "__main__":
    main()
