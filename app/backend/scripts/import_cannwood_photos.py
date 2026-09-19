"""
Attach the Cannwood annual monitoring report photo plates to their surveys.

The reports (2020-2026) carry pages of photographs: each page is a plate
holding several numbered photos with their captions on the facing page. The
plates document a parcel's condition over a visit, not a single species, so
they belong to the survey rather than to any of its sightings. They are stored
as camera_trap_image rows hanging off survey_id and shown by the survey-level
photo gallery, which this script also switches on for the Botanical survey
type (allow_survey_photos).

Pairing an individual photo with its individual caption is not reliable, so
this script does not try. It works a whole plate at a time, and attaches one
only when the evidence is unambiguous:

  1. the file is a photograph: at least MIN_PHOTO_BYTES and a JPEG (the
     Ordnance Survey plans in these reports are exported as PNG, the page
     furniture and logos are tiny);
  2. the plate has a caption page: the facing page (plate page minus one) if
     it carries at least MIN_CAPTION_MARKERS numbered captions, otherwise the
     plate's own page if it does. Plates whose captions are burned into the
     scan (the whole 2021 report) have no caption text and are skipped;
  3. that caption page names exactly one parcel, and it is one of the parcels
     in data/cannwood_botanical/locations.json. A page covering several
     parcels, or naming a parcel the registry does not know, is skipped: there
     is no way to say which of them a given plate shows;
  4. a Botanical survey exists at that location in the report year.

Everything else is skipped and counted, with the reason logged.

Photos and page text are expected under --photos-dir, which must be inside the
container (only app/backend is mounted):

    scripts/data/cannwood_photos/
        page_text.json       # {year: {page number: page text}}
        2020/p17_0.jpg ...   # p<plate page>_<index on the page>

Idempotent: each plate is uploaded under a stable derived filename, and a
plate already present on its survey is skipped, so re-running adds nothing.

Usage:
    ./run staging import_cannwood_photos.py                       # dry run
    ./run staging import_cannwood_photos.py --no-dry-run --yes    # apply
"""

import json
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session

from database.connection import get_engine
from models import (
    CameraTrapImage,
    Location,
    Organisation,
    ProcessingStatus,
    Survey,
    SurveyType,
)
from script_utils import get_arg_parser
from services.r2_storage import upload_image_file

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data" / "cannwood_botanical"
DEFAULT_PHOTOS_DIR = Path(__file__).parent / "data" / "cannwood_photos"

SURVEY_TYPE_NAME = "Botanical"

#: Anything smaller is page furniture, not a photograph: the repeated FCLS
#: logo is ~7.7KB and the cover-page decorations are a few tens of KB.
MIN_PHOTO_BYTES = 40 * 1024

#: The plans and maps in these reports are PNG exports; photographs are JPEG.
PHOTO_SUFFIXES = {".jpg", ".jpeg"}

#: A caption page carries a run of numbered captions ("12.", "2/ 3.", "4-7.",
#: "18A."). Two or more of them tell a caption page apart from body prose that
#: happens to open with a numbered heading.
MIN_CAPTION_MARKERS = 2

PLATE_FILE_RE = re.compile(r"^p(\d{2,3})_(\d+)\.(jpg|jpeg|png)$", re.I)
CAPTION_MARKER_RE = re.compile(
    r"^\s*\d{1,2}[A-Z]?(\s*[&/,–-]\s*\d{1,2}[A-Z]?)*\s*\.(?!\d)\s+\S", re.M
)
PAGE_FOOTER_RE = re.compile(r"Cannwood[^\n]*p\.\s*\S+")
#: Parcel numbers are four digits. A four-digit number the registry doesn't
#: know is still a parcel the page is talking about, e.g. "Fields 6294 and
#: 7494" in the 2023 report, so it counts towards ambiguity.
FOUR_DIGIT_RE = re.compile(r"(?<!\d)\d{4}(?!\d)")
#: Four-digit numbers in this range are report and citation years, not parcels.
YEAR_RANGE = range(1900, 2031)


def load_locations() -> list[dict]:
    with open(DATA_DIR / "locations.json") as f:
        return json.load(f)["locations"]


def build_location_patterns(registry: list[dict]) -> list[tuple[re.Pattern, str]]:
    """One regex per name/alias. Bare parcel numbers must not match inside a longer number."""
    patterns = []
    for entry in registry:
        for text in [entry["name"], *entry.get("aliases", [])]:
            if re.fullmatch(r"\d{4}", text):
                patterns.append((re.compile(rf"(?<!\d){text}(?!\d)"), entry["key"]))
            else:
                patterns.append((re.compile(re.escape(text), re.I), entry["key"]))
    return patterns


def page_text_of(pages: dict, page: int) -> str:
    """A page's text with the running footer removed, so it can't be mistaken for content."""
    return PAGE_FOOTER_RE.sub("", pages.get(str(page), ""))


def is_caption_page(text: str) -> bool:
    return len(CAPTION_MARKER_RE.findall(text)) >= MIN_CAPTION_MARKERS


def find_caption_page(pages: dict, plate_page: int) -> tuple[int, str] | None:
    """Captions face the plate; a few reports print them under it instead."""
    for candidate in (plate_page - 1, plate_page):
        text = page_text_of(pages, candidate)
        if is_caption_page(text):
            return candidate, text
    return None


def parcels_named(text: str, patterns: list[tuple[re.Pattern, str]]) -> tuple[set[str], set[str]]:
    """Registry keys named on the page, and parcel numbers it names that we don't know.

    Field 1970 is a real parcel as well as a plausible year; it is in the
    registry, so it is matched as known before the year filter is reached.
    """
    known = {key for pattern, key in patterns if pattern.search(text)}
    unknown = {
        number
        for number in FOUR_DIGIT_RE.findall(text)
        if int(number) not in YEAR_RANGE
        and not any(pattern.fullmatch(number) for pattern, _ in patterns)
    }
    return known, unknown


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


def resolve_locations(db: Session, org: Organisation, registry: list[dict]) -> dict[str, Location]:
    """Registry key -> the org's Location, matched by name or alias as the botanical import does."""
    existing = db.query(Location).filter(Location.organisation_id == org.id).all()
    by_name = {loc.name.lower(): loc for loc in existing}
    resolved = {}
    for entry in registry:
        for candidate in [entry["name"], *entry.get("aliases", [])]:
            location = by_name.get(candidate.lower())
            if location:
                resolved[entry["key"]] = location
                break
    return resolved


def find_survey(
    db: Session, org: Organisation, survey_type: SurveyType, location: Location, year: int
) -> Survey | None:
    """The Botanical survey at this parcel in this report year (at most one exists)."""
    surveys = db.query(Survey).filter(
        Survey.organisation_id == org.id,
        Survey.survey_type_id == survey_type.id,
        Survey.location_id == location.id,
    ).all()
    matching = [s for s in surveys if s.date and s.date.year == year]
    return matching[0] if matching else None


def enable_survey_photos(db: Session, survey_type: SurveyType, stats: dict) -> None:
    if not survey_type.allow_survey_photos:
        survey_type.allow_survey_photos = True
        stats["survey_type_flag_set"] += 1
        logger.info(f"Enabled allow_survey_photos on {SURVEY_TYPE_NAME!r}")


def plate_filename(year: str, page: int, index: str, suffix: str) -> str:
    """Stable across runs and unique across years, so it doubles as the idempotency key."""
    return f"cannwood-{year}-p{page:02d}-{index}{suffix.lower()}"


def import_photos(
    db: Session, org: Organisation, survey_type: SurveyType,
    locations: dict[str, Location], patterns: list[tuple[re.Pattern, str]],
    photos_dir: Path, dry_run: bool, stats: dict,
) -> None:
    with open(photos_dir / "page_text.json") as f:
        page_text = json.load(f)

    for year_dir in sorted(p for p in photos_dir.iterdir() if p.is_dir()):
        year = year_dir.name
        if not year.isdigit():
            continue
        pages = page_text.get(year, {})
        if not pages:
            logger.warning(f"{year}: no page text, skipping the whole year")
        logger.info(f"\n{year}:")

        files_by_page: dict[int, list[tuple[str, Path]]] = {}
        for path in sorted(year_dir.iterdir()):
            match = PLATE_FILE_RE.match(path.name)
            if not match:
                continue
            files_by_page.setdefault(int(match.group(1)), []).append((match.group(2), path))

        for plate_page in sorted(files_by_page):
            photos = []
            for index, path in files_by_page[plate_page]:
                if path.suffix.lower() not in PHOTO_SUFFIXES:
                    stats["skipped_not_a_photo"] += 1
                    logger.info(f"  p{plate_page:02d} {path.name}: skipped, a plan or map (not JPEG)")
                elif path.stat().st_size < MIN_PHOTO_BYTES:
                    stats["skipped_too_small"] += 1
                    logger.info(
                        f"  p{plate_page:02d} {path.name}: skipped, "
                        f"{path.stat().st_size // 1024}KB is page furniture, not a photo"
                    )
                else:
                    photos.append((index, path))
            if not photos:
                continue

            caption = find_caption_page(pages, plate_page)
            if not caption:
                stats["skipped_no_caption_page"] += len(photos)
                logger.info(
                    f"  p{plate_page:02d}: skipped {len(photos)} photo(s), no caption page "
                    "(neither the facing page nor its own carries numbered captions)"
                )
                continue
            caption_page, caption_text = caption

            known, unknown = parcels_named(caption_text, patterns)
            if len(known) != 1 or unknown:
                stats["skipped_ambiguous_location"] += len(photos)
                named = sorted(known) + [f"{n} (not in the registry)" for n in sorted(unknown)]
                reason = "names no parcel" if not named else f"names {len(named)} parcels: {', '.join(named)}"
                logger.info(
                    f"  p{plate_page:02d}: skipped {len(photos)} photo(s), "
                    f"caption page {caption_page} {reason}"
                )
                continue
            key = known.pop()

            location = locations.get(key)
            if not location:
                stats["skipped_no_survey"] += len(photos)
                logger.info(
                    f"  p{plate_page:02d}: skipped {len(photos)} photo(s), "
                    f"no location for parcel {key!r}"
                )
                continue

            survey = find_survey(db, org, survey_type, location, int(year))
            if not survey:
                stats["skipped_no_survey"] += len(photos)
                logger.info(
                    f"  p{plate_page:02d}: skipped {len(photos)} photo(s), "
                    f"no {SURVEY_TYPE_NAME} survey at {location.name!r} in {year}"
                )
                continue

            for index, path in photos:
                filename = plate_filename(year, plate_page, index, path.suffix)
                existing = db.query(CameraTrapImage).filter(
                    CameraTrapImage.survey_id == survey.id,
                    CameraTrapImage.filename == filename,
                ).first()
                if existing:
                    stats["already_attached"] += 1
                    logger.info(f"  p{plate_page:02d} {filename}: already attached, skipping")
                    continue

                size = path.stat().st_size
                if dry_run:
                    stats["would_attach"] += 1
                    logger.info(
                        f"  p{plate_page:02d} {filename}: would attach to survey {survey.id} "
                        f"({location.name}, {survey.date}), {size // 1024}KB"
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
                    f"  p{plate_page:02d} {filename}: attached to survey {survey.id} "
                    f"({location.name}, {survey.date})"
                )


def main() -> None:
    parser = get_arg_parser(description=__doc__)
    parser.add_argument("--org-slug", default="cannwood", help="Organisation slug (default: cannwood)")
    parser.add_argument(
        "--photos-dir", default=str(DEFAULT_PHOTOS_DIR),
        help="Directory holding page_text.json and the per-year plate folders",
    )
    parser.add_argument("--yes", "-y", action="store_true", help="Apply without interactive confirmation")
    args = parser.parse_args()

    photos_dir = Path(args.photos_dir)
    if not (photos_dir / "page_text.json").is_file():
        logger.error(f"No page_text.json in {photos_dir}")
        sys.exit(1)

    stats = {
        "survey_type_flag_set": 0, "attached": 0, "would_attach": 0,
        "already_attached": 0, "skipped_not_a_photo": 0, "skipped_too_small": 0,
        "skipped_no_caption_page": 0, "skipped_ambiguous_location": 0,
        "skipped_no_survey": 0,
    }

    registry = load_locations()
    patterns = build_location_patterns(registry)

    with Session(get_engine()) as db:
        org = find_org(db, args.org_slug)
        logger.info(f"Attaching report plates in organisation {org.name!r} (id {org.id})")

        survey_type = find_survey_type(db, org)
        enable_survey_photos(db, survey_type, stats)
        locations = resolve_locations(db, org, registry)
        import_photos(db, org, survey_type, locations, patterns, photos_dir, args.dry_run, stats)

        logger.info("")
        for key, value in stats.items():
            logger.info(f"  {key}: {value}")

        if args.dry_run:
            db.rollback()
            logger.info("\nDRY RUN complete, rolled back. Re-run with --no-dry-run to apply.")
            return
        if not args.yes:
            confirm = input("\nApply these changes? [y/N] ")
            if confirm.strip().lower() != "y":
                db.rollback()
                logger.info("Aborted, rolled back.")
                return
        db.commit()
        logger.info("\nImport committed.")


if __name__ == "__main__":
    main()
