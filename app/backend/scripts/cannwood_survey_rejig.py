"""
One-off Cannwood survey rejig (July 2026).

1. Rename the "Walking" survey type to "Bird".
2. Recategorise surveys 943, 970 and 982 to the "Turtle Dove" survey type.
3. Break survey 943's wildcat sighting out into a new "Ad hoc" survey,
   copying 943's date, times, location and surveyor links; the sighting
   (with its individuals) is repointed at the new survey.

The "Turtle Dove" and "Ad hoc" survey types must already exist for the
organisation — the script fails loudly if they don't. Safe to re-run:
each step detects when it has already been applied.

Usage:
    ./run staging cannwood_survey_rejig.py                     # dry-run (preview)
    ./run staging cannwood_survey_rejig.py --no-dry-run --yes  # apply
"""

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session

from database.connection import get_engine
from models import (
    Organisation,
    Sighting,
    Species,
    Survey,
    SurveyStatus,
    SurveySurveyor,
    SurveyType,
)
from script_utils import get_arg_parser

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

ORG_NAME_PATTERN = "%cannwood%"
TURTLE_DOVE_SURVEY_IDS = [943, 970, 982]
WILDCAT_SURVEY_ID = 943


def find_one_org(db: Session) -> Organisation:
    orgs = db.query(Organisation).filter(Organisation.name.ilike(ORG_NAME_PATTERN)).all()
    if len(orgs) != 1:
        logger.error(f"Expected exactly one organisation matching {ORG_NAME_PATTERN!r}, found {len(orgs)}")
        sys.exit(1)
    return orgs[0]


def find_types(db: Session, org_id: int, name_pattern: str) -> list[SurveyType]:
    return db.query(SurveyType).filter(
        SurveyType.organisation_id == org_id,
        SurveyType.name.ilike(name_pattern),
    ).all()


def require_one_type(db: Session, org_id: int, name_pattern: str, label: str) -> SurveyType:
    matches = find_types(db, org_id, name_pattern)
    if len(matches) != 1:
        names = [t.name for t in matches]
        logger.error(
            f"Expected exactly one {label!r} survey type (pattern {name_pattern!r}), "
            f"found {len(matches)}: {names}"
        )
        sys.exit(1)
    return matches[0]


def rename_walking_to_bird(db: Session, org_id: int) -> None:
    walking = find_types(db, org_id, "%walking%")
    if not walking:
        bird = find_types(db, org_id, "bird")
        if bird:
            logger.info(f"1. Rename: no 'Walking' type; 'Bird' (id={bird[0].id}) already exists — skipping")
            return
        logger.error("1. Rename: found neither a 'Walking' nor a 'Bird' survey type")
        sys.exit(1)
    if len(walking) > 1:
        logger.error(f"1. Rename: multiple types match 'walking': {[t.name for t in walking]}")
        sys.exit(1)
    logger.info(f"1. Rename: survey type {walking[0].id} {walking[0].name!r} -> 'Bird'")
    walking[0].name = "Bird"


def recategorise_turtle_dove(db: Session, org: Organisation) -> None:
    turtle_dove = require_one_type(db, org.id, "%turtle%dove%", "Turtle Dove")
    for survey_id in TURTLE_DOVE_SURVEY_IDS:
        survey = db.get(Survey, survey_id)
        if survey is None:
            logger.error(f"2. Recategorise: survey {survey_id} not found")
            sys.exit(1)
        if survey.organisation_id != org.id:
            logger.error(f"2. Recategorise: survey {survey_id} belongs to organisation {survey.organisation_id}, not {org.name!r}")
            sys.exit(1)
        old_type = db.get(SurveyType, survey.survey_type_id) if survey.survey_type_id else None
        if survey.survey_type_id == turtle_dove.id:
            logger.info(f"2. Recategorise: survey {survey_id} already 'Turtle Dove' — skipping")
            continue
        logger.info(
            f"2. Recategorise: survey {survey_id} (date={survey.date}) "
            f"{old_type.name if old_type else None!r} -> {turtle_dove.name!r}"
        )
        survey.survey_type_id = turtle_dove.id


def break_out_wildcat(db: Session, org: Organisation) -> None:
    ad_hoc = require_one_type(db, org.id, "ad%hoc", "Ad hoc")
    source = db.get(Survey, WILDCAT_SURVEY_ID)
    if source is None or source.organisation_id != org.id:
        logger.error(f"3. Wildcat: survey {WILDCAT_SURVEY_ID} not found in {org.name!r}")
        sys.exit(1)

    wildcat_sightings = db.query(Sighting).join(Species).filter(
        Sighting.survey_id == WILDCAT_SURVEY_ID,
        Species.name.ilike("%wildcat%"),
    ).all()
    if not wildcat_sightings:
        already_moved = db.query(Sighting).join(Species).join(
            Survey, Sighting.survey_id == Survey.id
        ).filter(
            Survey.survey_type_id == ad_hoc.id,
            Survey.date == source.date,
            Species.name.ilike("%wildcat%"),
        ).count()
        if already_moved:
            logger.info(f"3. Wildcat: no wildcat sighting on survey {WILDCAT_SURVEY_ID}; "
                        f"an Ad hoc survey on {source.date} already has one — skipping")
            return
        logger.error(f"3. Wildcat: no sighting with species matching 'wildcat' on survey {WILDCAT_SURVEY_ID}")
        sys.exit(1)

    # Only carry the survey-level location over if the Ad hoc type uses one.
    location_id = None if ad_hoc.location_at_sighting_level else source.location_id
    new_survey = Survey(
        organisation_id=org.id,
        survey_type_id=ad_hoc.id,
        date=source.date,
        start_time=source.start_time,
        end_time=source.end_time,
        location_id=location_id,
        status=SurveyStatus.completed,
        notes=f"Broken out from survey {source.id} (wildcat sighting)",
    )
    db.add(new_survey)
    db.flush()  # assigns new_survey.id

    surveyor_links = db.query(SurveySurveyor).filter(SurveySurveyor.survey_id == source.id).all()
    for link in surveyor_links:
        db.add(SurveySurveyor(survey_id=new_survey.id, surveyor_id=link.surveyor_id))

    for sighting in wildcat_sightings:
        species = db.get(Species, sighting.species_id)
        logger.info(
            f"3. Wildcat: moving sighting {sighting.id} ({species.name}, count={sighting.count}) "
            f"from survey {source.id} to new Ad hoc survey {new_survey.id} "
            f"(date={source.date}, {len(surveyor_links)} surveyor link(s) copied)"
        )
        sighting.survey_id = new_survey.id


def main() -> None:
    parser = get_arg_parser(description=__doc__)
    parser.add_argument('--yes', '-y', action='store_true', help='Skip confirmation prompt')
    args = parser.parse_args()

    logger.info(f"{'DRY RUN — no changes will be committed' if args.dry_run else 'LIVE RUN'}\n")

    with Session(get_engine()) as db:
        org = find_one_org(db)
        logger.info(f"Organisation: {org.name} (id={org.id})\n")

        rename_walking_to_bird(db, org.id)
        recategorise_turtle_dove(db, org)
        break_out_wildcat(db, org)

        if args.dry_run:
            db.rollback()
            logger.info("\nDRY RUN complete — rolled back. Re-run with --no-dry-run to apply.")
            return

        if not args.yes:
            response = input("\nApply all changes? [y/N]: ")
            if response.lower() != 'y':
                db.rollback()
                logger.info("Aborted.")
                return

        db.commit()
        logger.info("\nDone.")


if __name__ == "__main__":
    main()
