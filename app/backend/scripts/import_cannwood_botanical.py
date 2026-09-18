"""
Import the Cannwood annual monitoring report data (2020-2026).

Reads the hand-transcribed data in scripts/data/cannwood_botanical/ (see its
README.md) and creates, for the Cannwood organisation:

- plant species from the registry (the existing empty 'plant' species type);
- area locations for the surveyed parcels (matched by name/alias first);
- a "Botanical" survey type with allow_frequency_score on, linked to the
  plant species type and the parcel locations;
- a "Chris Smith" surveyor;
- one survey per (table, parcel) with sightings carrying percent_frequency
  and/or frequency_band; and
- optionally, the curated notable fauna records as sightings on ad hoc
  surveys (only for species that already exist; fauna species are never
  created).

Idempotent: a survey whose (survey type, location, date) already exists and
has sightings is skipped, so re-running never duplicates data. Run
scripts/verify_cannwood_botanical.py first; this script re-runs it and
refuses to import if verification fails.

Usage:
    ./run dev import_cannwood_botanical.py                     # dry run
    ./run prod import_cannwood_botanical.py --no-dry-run       # apply
    ./run prod import_cannwood_botanical.py --no-dry-run --skip-fauna
"""

import json
import logging
import sys
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from sqlmodel import col

from database.connection import get_engine
from models import (
    Location,
    LocationType,
    Organisation,
    RecordMode,
    Sighting,
    Species,
    SpeciesType,
    Survey,
    SurveySurveyor,
    SurveyType,
    SurveyTypeLocationLink,
    SurveyTypeSpeciesTypeLink,
    Surveyor,
)
from script_utils import get_arg_parser
from verify_cannwood_botanical import main as verify_data

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data" / "cannwood_botanical"

SURVEY_TYPE_NAME = "Botanical"
SURVEY_TYPE_DESCRIPTION = (
    "Botanical monitoring of the meadows, rewilding fields and sown plots: "
    "quadrat/transect surveys scoring each species' percentage frequency "
    "(share of quadrats containing it) and relative frequency band "
    "(5 = 81-100% of quadrats ... 1 = 1-10%, + = present but not caught by "
    "a quadrat), plus walkabout presence records. Series digitised from "
    "C.J. Smith's annual monitoring reports (2020-2026)."
)
SURVEYOR_FIRST_NAME = "Chris"
SURVEYOR_LAST_NAME = "Smith"

TABLE_FILES = [
    "tables_2020.json",
    "tables_2021.json",
    "tables_2023.json",
    "tables_2024.json",
    "tables_2025.json",
    "tables_2026.json",
    "presence_lists.json",
]


def load(name: str) -> dict:
    with open(DATA_DIR / name) as f:
        return json.load(f)


def derive_band(percent: float) -> str:
    """The reports' rounding convention: round to whole percent, then band."""
    rounded = int(Decimal(str(percent)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    for threshold, band in ((81, "5"), (61, "4"), (41, "3"), (21, "2"), (11, "1+")):
        if rounded >= threshold:
            return band
    return "1"


def cell_parts(cell):
    if isinstance(cell, dict):
        return cell.get("value"), cell.get("note"), bool(cell.get("extra"))
    return cell, None, False


def find_org(db: Session, slug: str) -> Organisation:
    org = db.query(Organisation).filter(Organisation.slug == slug).one_or_none()
    if not org:
        logger.error(f"No organisation with slug {slug!r}")
        sys.exit(1)
    return org


def ensure_plant_species_type(db: Session) -> SpeciesType:
    species_type = db.query(SpeciesType).filter(SpeciesType.name == 'plant').one_or_none()
    if species_type:
        return species_type
    species_type = SpeciesType(name='plant', display_name='Plants')
    db.add(species_type)
    db.flush()
    logger.info("Created species type 'plant'")
    return species_type


def ensure_species(db: Session, plant_type: SpeciesType, stats: dict) -> dict[str, Species]:
    """Create registry species that don't exist yet; return slug -> Species."""
    registry = load("species.json")["species"]
    existing = db.query(Species).filter(Species.species_type_id == plant_type.id).all()
    by_scientific = {
        (s.scientific_name or "").lower(): s for s in existing if s.scientific_name
    }
    by_name = {(s.name or "").lower(): s for s in existing if s.name}

    result: dict[str, Species] = {}
    for entry in registry:
        species = (
            by_scientific.get(entry["scientific_name"].lower())
            or by_name.get(entry["common_name"].lower())
        )
        if not species:
            species = Species(
                name=entry["common_name"],
                scientific_name=entry["scientific_name"],
                species_code=entry["code"],
                species_type_id=plant_type.id,
                conservation_status="Somerset Notable" if entry.get("notable") else None,
            )
            db.add(species)
            db.flush()
            stats["species_created"] += 1
        result[entry["slug"]] = species
    return result


def ensure_locations(db: Session, org: Organisation, stats: dict) -> dict[str, Location]:
    """Match parcels to existing org locations by name/alias, creating the rest."""
    registry = load("locations.json")["locations"]
    existing = db.query(Location).filter(Location.organisation_id == org.id).all()
    by_name = {loc.name.lower(): loc for loc in existing}

    result: dict[str, Location] = {}
    for entry in registry:
        candidates = [entry["name"], *entry.get("aliases", [])]
        location = next(
            (by_name[c.lower()] for c in candidates if c.lower() in by_name), None
        )
        if not location:
            location = Location(
                name=entry["name"],
                organisation_id=org.id,
                location_type=LocationType(entry["location_type"]),
            )
            db.add(location)
            db.flush()
            by_name[location.name.lower()] = location
            stats["locations_created"] += 1
            logger.info(f"  created location {entry['name']!r} (no boundary yet)")
        result[entry["key"]] = location
    return result


def ensure_survey_type(
    db: Session, org: Organisation, locations: dict[str, Location],
    plant_type: SpeciesType, stats: dict,
) -> SurveyType:
    survey_type = db.query(SurveyType).filter(
        SurveyType.organisation_id == org.id,
        SurveyType.name == SURVEY_TYPE_NAME,
    ).one_or_none()
    if not survey_type:
        survey_type = SurveyType(
            name=SURVEY_TYPE_NAME,
            description=SURVEY_TYPE_DESCRIPTION,
            organisation_id=org.id,
            allow_geolocation=False,
            allow_sighting_notes=True,
            allow_frequency_score=True,
            allow_show_description=True,
            record_mode=RecordMode.list,
            color="green",
        )
        db.add(survey_type)
        db.flush()
        stats["survey_types_created"] += 1
        logger.info(f"Created survey type {SURVEY_TYPE_NAME!r}")
    else:
        # Make sure the flag is on for an existing type of this name.
        if not survey_type.allow_frequency_score:
            survey_type.allow_frequency_score = True
            logger.info(f"Enabled allow_frequency_score on existing {SURVEY_TYPE_NAME!r}")

    linked_species_types = {
        link.species_type_id
        for link in db.query(SurveyTypeSpeciesTypeLink).filter(
            SurveyTypeSpeciesTypeLink.survey_type_id == survey_type.id
        )
    }
    if plant_type.id not in linked_species_types:
        db.add(SurveyTypeSpeciesTypeLink(
            survey_type_id=survey_type.id, species_type_id=plant_type.id
        ))

    linked_locations = {
        link.location_id
        for link in db.query(SurveyTypeLocationLink).filter(
            SurveyTypeLocationLink.survey_type_id == survey_type.id
        )
    }
    for location in locations.values():
        if location.id not in linked_locations:
            db.add(SurveyTypeLocationLink(
                survey_type_id=survey_type.id, location_id=location.id
            ))
            linked_locations.add(location.id)
    return survey_type


def ensure_surveyor(db: Session, org: Organisation, stats: dict) -> Surveyor:
    surveyor = db.query(Surveyor).filter(
        Surveyor.organisation_id == org.id,
        Surveyor.first_name == SURVEYOR_FIRST_NAME,
        Surveyor.last_name == SURVEYOR_LAST_NAME,
    ).first()
    if not surveyor:
        surveyor = Surveyor(
            first_name=SURVEYOR_FIRST_NAME,
            last_name=SURVEYOR_LAST_NAME,
            organisation_id=org.id,
        )
        db.add(surveyor)
        db.flush()
        stats["surveyors_created"] += 1
        logger.info(f"Created surveyor {SURVEYOR_FIRST_NAME} {SURVEYOR_LAST_NAME}")
    return surveyor


def survey_exists_with_sightings(
    db: Session, org: Organisation, survey_type: SurveyType,
    location: Location, survey_date: date,
) -> bool:
    survey = db.query(Survey).filter(
        Survey.organisation_id == org.id,
        Survey.survey_type_id == survey_type.id,
        Survey.location_id == location.id,
        Survey.date == survey_date,
    ).first()
    if not survey:
        return False
    has_sightings = db.query(Sighting).filter(Sighting.survey_id == survey.id).first()
    return has_sightings is not None


def import_tables(
    db: Session, org: Organisation, survey_type: SurveyType, surveyor: Surveyor,
    species: dict[str, Species], locations: dict[str, Location], stats: dict,
) -> None:
    for filename in TABLE_FILES:
        for table in load(filename)["tables"]:
            parcels = table["parcels"]
            survey_date = date.fromisoformat(table["date"])
            date_note = (
                "" if table.get("date_precision", "day") == "day"
                else " Survey date approximate (not stated to the day in the report)."
            )
            survey_notes = f"{table['method']} Source: {table['source']}.{date_note}"

            for column, parcel_key in enumerate(parcels):
                location = locations[parcel_key]
                if survey_exists_with_sightings(db, org, survey_type, location, survey_date):
                    stats["surveys_skipped"] += 1
                    logger.info(
                        f"  {table['table']} / {location.name}: already imported, skipping"
                    )
                    continue

                survey = Survey(
                    date=survey_date,
                    organisation_id=org.id,
                    survey_type_id=survey_type.id,
                    location_id=location.id,
                    notes=survey_notes,
                )
                db.add(survey)
                db.flush()
                db.add(SurveySurveyor(survey_id=survey.id, surveyor_id=surveyor.id))
                stats["surveys_created"] += 1

                for row in table["rows"]:
                    slug, *cells = row
                    value, note, _extra = cell_parts(cells[column])
                    if value is None:
                        continue
                    percent = None
                    if isinstance(value, (int, float)):
                        percent = Decimal(str(value))
                        band = derive_band(float(value))
                    elif value == "D":
                        band = "+"
                        dominant = "Dominant in the sward (flagged red in the source table)."
                        note = f"{note} {dominant}".strip() if note else dominant
                    else:
                        band = value
                    db.add(Sighting(
                        survey_id=survey.id,
                        species_id=species[slug].id,
                        count=1,
                        percent_frequency=percent,
                        frequency_band=band,
                        notes=note,
                    ))
                    stats["sightings_created"] += 1


def import_fauna(
    db: Session, org: Organisation, surveyor: Surveyor,
    locations: dict[str, Location], stats: dict,
) -> None:
    """Notable fauna records go on ad hoc surveys, species resolved by name only."""
    ad_hoc = db.query(SurveyType).filter(
        SurveyType.organisation_id == org.id,
        col(SurveyType.name).ilike("%ad hoc%"),
    ).first()
    if not ad_hoc:
        logger.warning("No ad hoc survey type found; skipping fauna records")
        return

    for record in load("fauna.json")["records"]:
        species = db.query(Species).filter(
            col(Species.name).ilike(record["species_name"])
        ).first()
        if not species and record.get("scientific_name"):
            species = db.query(Species).filter(
                col(Species.scientific_name).ilike(record["scientific_name"])
            ).first()
        if not species:
            stats["fauna_skipped"] += 1
            logger.warning(
                f"  fauna: no species {record['species_name']!r} in the database, skipping"
            )
            continue

        survey_date = date.fromisoformat(record["date"])
        location = locations.get(record["location"]) if record.get("location") else None
        existing = db.query(Survey).join(Sighting).filter(
            Survey.organisation_id == org.id,
            Survey.survey_type_id == ad_hoc.id,
            Survey.date == survey_date,
            Sighting.species_id == species.id,
        ).first()
        if existing:
            stats["fauna_skipped"] += 1
            continue

        survey = Survey(
            date=survey_date,
            organisation_id=org.id,
            survey_type_id=ad_hoc.id,
            location_id=location.id if (location and not ad_hoc.location_at_sighting_level) else None,
            notes="Imported from the Cannwood annual monitoring reports (C.J. Smith, FCLS).",
        )
        db.add(survey)
        db.flush()
        db.add(SurveySurveyor(survey_id=survey.id, surveyor_id=surveyor.id))
        db.add(Sighting(
            survey_id=survey.id,
            species_id=species.id,
            count=record["count"],
            location_id=location.id if (location and ad_hoc.location_at_sighting_level) else None,
            notes=record["notes"],
        ))
        stats["fauna_created"] += 1


def main() -> None:
    parser = get_arg_parser(description=__doc__)
    parser.add_argument("--org-slug", default="cannwood", help="Organisation slug (default: cannwood)")
    parser.add_argument("--skip-fauna", action="store_true", help="Skip the notable fauna records")
    parser.add_argument("--yes", "-y", action="store_true", help="Apply without interactive confirmation")
    args = parser.parse_args()

    if verify_data() != 0:
        logger.error("Data verification failed; not importing.")
        sys.exit(1)

    stats = {
        "species_created": 0, "locations_created": 0, "survey_types_created": 0,
        "surveyors_created": 0, "surveys_created": 0, "surveys_skipped": 0,
        "sightings_created": 0, "fauna_created": 0, "fauna_skipped": 0,
    }

    with Session(get_engine()) as db:
        org = find_org(db, args.org_slug)
        logger.info(f"Importing into organisation {org.name!r} (id {org.id})")

        plant_type = ensure_plant_species_type(db)
        species = ensure_species(db, plant_type, stats)
        locations = ensure_locations(db, org, stats)
        survey_type = ensure_survey_type(db, org, locations, plant_type, stats)
        surveyor = ensure_surveyor(db, org, stats)
        import_tables(db, org, survey_type, surveyor, species, locations, stats)
        if not args.skip_fauna:
            import_fauna(db, org, surveyor, locations, stats)

        logger.info("")
        for key, value in stats.items():
            logger.info(f"  {key}: {value}")

        if args.dry_run:
            db.rollback()
            logger.info("\nDRY RUN complete — rolled back. Re-run with --no-dry-run to apply.")
            return
        if not args.yes:
            confirm = input("\nApply these changes? [y/N] ")
            if confirm.strip().lower() != "y":
                db.rollback()
                logger.info("Aborted — rolled back.")
                return
        db.commit()
        logger.info("\nImport committed.")


if __name__ == "__main__":
    main()
