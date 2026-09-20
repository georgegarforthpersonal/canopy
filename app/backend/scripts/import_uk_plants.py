"""
Import the UK flora from NBN Atlas so any plant can be picked when recording.

Botanical surveys need the whole flora available, not just the species already
recorded: a surveyor finding something new must be able to select it. This
fetches every plant taxon NBN Atlas holds for the UK and adds the ones we do
not have yet.

Groups fetched (vascular plants, bryophytes and stoneworts; algae are
deliberately excluded, they are not what a botanical surveyor records):
flowering plant, conifer, fern, clubmoss, horsetail, moss, liverwort,
stonewort. Ranks kept: species, subspecies and genus. Genus matters because
recorders legitimately stop at genus ("Quercus sp.", "Epilobium sp.").

Additive and idempotent: an existing plant is never renamed, retyped or
deleted, and re-running adds nothing. Existing rows are matched on the
normalised scientific name, so running twice cannot duplicate a species.

VALIDATION: before writing anything it checks that every plant already in the
database appears in the fetched list, and reports any that do not. Known
exceptions are listed in EXPECTED_UNMATCHED below with the reason; anything
unexpected fails the run unless --allow-unmatched is passed.

Usage:
    ./run staging import_uk_plants.py                    # dry run + validation
    ./run staging import_uk_plants.py --no-dry-run --yes
    ./run staging import_uk_plants.py --validate-only
"""

import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from clients.nbn_atlas import NBNAtlasClient
from database.connection import get_db_cursor
from script_utils import get_arg_parser

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

SPECIES_TYPE = "plant"

#: NBN taxonGroup values that make up the flora a botanist records.
PLANT_GROUPS = [
    "flowering plant", "conifer", "fern", "clubmoss", "horsetail",
    "moss", "liverwort", "stonewort",
]

#: Ranks worth offering in a species picker.
ALLOWED_RANKS = {"species", "subspecies", "genus"}

#: Plants already in the database that will not match the fetched list, with
#: the reason. These are not coverage gaps: the taxon is present in NBN under
#: its current name (NBN follows a different nomenclature from Stace 2019, the
#: reports' authority), or the row is a composite label of our own making.
EXPECTED_UNMATCHED = {
    "Agrostis capillaris/A. stolonifera":
        "our own aggregate label; both species are present individually",
    "Dactylorhiza fuchsii/D. maculata (incl. hybrids)":
        "our own aggregate label; both species are present individually",
    "Festuca gigantea":
        "NBN lists Giant Fescue under its current name Schedonorus giganteus",
    "Coronopus squamatus":
        "NBN lists Swine-cress under its current name Lepidium coronopus",
    "Taraxacum officinale agg.":
        "NBN holds the dandelion aggregate at genus rank (Taraxacum)",
}


def normalise(name: str) -> str:
    """Comparable form of a scientific name: case, hybrid signs and the
    subspecies/variety abbreviations all vary between sources."""
    text = (name or "").lower().replace("×", "x").replace("’", "'")
    text = re.sub(r"\b(ssp|subsp)\.?\s*", "subsp. ", text)
    text = re.sub(r"\bvar\.?\s*", "var. ", text)
    text = re.sub(r"\s+agg\.?$", "", text)
    text = re.sub(r"[^a-z. ]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def fetch_plants() -> list[dict]:
    """Every plant taxon NBN holds for the configured groups, deduped by guid."""
    seen: set[str] = set()
    out: list[dict] = []
    client = NBNAtlasClient()
    try:
        for group in PLANT_GROUPS:
            records = client.search_all(
                query="*:*", filter_query=f'taxonGroup_s:"{group}"', page_size=500
            )
            kept = 0
            for record in records:
                guid = record.get("guid")
                if not guid or guid in seen:
                    continue
                if record.get("rank") not in ALLOWED_RANKS:
                    continue
                name = (record.get("name") or "").strip()
                if not name:
                    continue
                seen.add(guid)
                common = (record.get("commonName") or "").split(",")[0].strip()
                out.append({
                    "guid": guid,
                    "scientific_name": name,
                    "common_name": common or None,
                    "rank": record.get("rank"),
                    "group": group,
                })
                kept += 1
            logger.info(f"  {group:16s} {len(records):6d} records, {kept:5d} kept")
    finally:
        client.close()
    return out


def existing_plants(cursor) -> list[tuple[int, str, str]]:
    cursor.execute(
        """
        SELECT s.id, COALESCE(s.name, ''), COALESCE(s.scientific_name, '')
        FROM species s
        JOIN species_type t ON t.id = s.species_type_id
        WHERE t.name = %s
        ORDER BY s.scientific_name
        """,
        (SPECIES_TYPE,),
    )
    return cursor.fetchall()


def validate(existing, by_name, genera) -> list[tuple[str, str]]:
    """Report which existing plants the fetched list does not cover."""
    unexpected = []
    logger.info("\nValidating the plants already recorded:")
    for _id, common, scientific in existing:
        key = normalise(scientific)
        if key in by_name:
            continue
        # "Quercus sp." is covered by the genus record.
        bare = re.sub(r"\bsp\.?$", "", key).strip()
        if bare in genera:
            continue
        # A subspecies is covered if its parent species is present.
        parent = re.sub(r"\bsubsp\..*$", "", key).strip()
        if parent and parent in by_name:
            continue
        reason = EXPECTED_UNMATCHED.get(scientific)
        if reason:
            logger.info(f"  expected gap: {common or scientific} ({scientific}) - {reason}")
        else:
            unexpected.append((common, scientific))
    covered = len(existing) - len(unexpected) - sum(
        1 for _i, _c, s in existing if s in EXPECTED_UNMATCHED
    )
    logger.info(
        f"  {covered} of {len(existing)} matched outright, "
        f"{sum(1 for _i, _c, s in existing if s in EXPECTED_UNMATCHED)} expected gaps, "
        f"{len(unexpected)} unexpected"
    )
    for common, scientific in unexpected:
        logger.error(f"  NOT FOUND: {common or '(no common name)'} ({scientific})")
    return unexpected


def main() -> None:
    parser = get_arg_parser(description=__doc__)
    parser.add_argument("--yes", "-y", action="store_true", help="Apply without confirmation")
    parser.add_argument("--validate-only", action="store_true",
                        help="Only check that existing plants are covered, then stop")
    parser.add_argument("--allow-unmatched", action="store_true",
                        help="Proceed even if an existing plant is missing from NBN")
    args = parser.parse_args()

    logger.info("Fetching the UK flora from NBN Atlas...")
    plants = fetch_plants()
    by_name: dict[str, dict] = {}
    for plant in plants:
        by_name.setdefault(normalise(plant["scientific_name"]), plant)
    genera = {normalise(p["scientific_name"]) for p in plants if p["rank"] == "genus"}
    ranks: dict[str, int] = {}
    for plant in plants:
        ranks[plant["rank"]] = ranks.get(plant["rank"], 0) + 1
    logger.info(f"\n{len(plants)} taxa fetched: " + ", ".join(f"{v} {k}" for k, v in sorted(ranks.items())))
    logger.info(f"  with a common name: {sum(1 for p in plants if p['common_name'])}")

    with get_db_cursor() as cursor:
        cursor.execute("SELECT id FROM species_type WHERE name = %s", (SPECIES_TYPE,))
        row = cursor.fetchone()
        if not row:
            logger.error(f"No species_type named {SPECIES_TYPE!r}")
            sys.exit(1)
        type_id = row[0]

        existing = existing_plants(cursor)
        unexpected = validate(existing, by_name, genera)
        if unexpected and not args.allow_unmatched:
            logger.error("\nSome existing plants are not in the fetched list. "
                         "Re-run with --allow-unmatched to import anyway.")
            sys.exit(1)
        if args.validate_only:
            logger.info("\nValidation only, nothing written.")
            return

        have = {normalise(scientific) for _id, _c, scientific in existing}
        to_add = [p for key, p in by_name.items() if key not in have]
        logger.info(f"\n{len(to_add)} new plants to add, {len(plants) - len(to_add)} already present.")
        for plant in to_add[:10]:
            logger.info(f"  e.g. {plant['scientific_name']} ({plant['common_name'] or 'no common name'})")

        if args.dry_run:
            logger.info("\nDRY RUN complete. Re-run with --no-dry-run to apply.")
            return
        if not args.yes:
            confirm = input(f"\nAdd {len(to_add)} plants? [y/N] ")
            if confirm.strip().lower() != "y":
                logger.info("Aborted.")
                return

        added = 0
        for plant in to_add:
            cursor.execute(
                """
                INSERT INTO species (name, scientific_name, species_type_id, nbn_atlas_guid)
                VALUES (%s, %s, %s, %s)
                """,
                (plant["common_name"], plant["scientific_name"], type_id, plant["guid"]),
            )
            added += 1
        logger.info(f"\nAdded {added} plants.")

        cursor.execute(
            """
            SELECT COUNT(*) FROM species s JOIN species_type t ON t.id = s.species_type_id
            WHERE t.name = %s
            """,
            (SPECIES_TYPE,),
        )
        logger.info(f"Plant species now in the database: {cursor.fetchone()[0]}")


if __name__ == "__main__":
    main()
