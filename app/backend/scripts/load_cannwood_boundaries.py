"""
Load the Cannwood botanical parcel boundaries into location.boundary_geometry.

Reads scripts/data/cannwood_botanical/boundaries.json (WGS84 GeoJSON polygons,
keyed by the location keys used by the botanical import) and writes each one
onto the matching Cannwood location, matched by name exactly as the import
script created them.

Where the geometry came from (see each entry's `source`):
  - field parcels: the estate's two HM Land Registry INSPIRE title polygons
    give the exact outer perimeter; the internal divisions come from flooding
    each RPA parcel centroid over an Environment Agency 1m LIDAR canopy height
    model, so the lines follow the hedge ridges. Cannwood deliberately opened
    gaps in these hedges for its rewilding, so plain hedge-tracing would merge
    the fields; the watershed still parts them along the longest standing ridge.
  - 5474: its RPA number is defunct (the land now sits inside parcel 4483, as
    the 2020 report predicted). Its old grid reference gives the historic
    centroid and the split follows a real hedge, but it is marked approximate.
  - West End Wood: OpenStreetMap, western sector only. Approximate.

Plots A, B and C have no boundary here: they were sown in 2024, after this
LIDAR was flown, so there is nothing to trace. Draw those three in the admin
map by hand.

Usage:
    ./run staging load_cannwood_boundaries.py               # dry run
    ./run staging load_cannwood_boundaries.py --no-dry-run
"""

import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db_cursor
from script_utils import get_arg_parser

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

DATA_FILE = Path(__file__).parent / "data" / "cannwood_botanical" / "boundaries.json"
ORG_SLUG = "cannwood"


def main() -> None:
    parser = get_arg_parser(description=__doc__)
    parser.add_argument("--org-slug", default=ORG_SLUG, help="Organisation slug (default: cannwood)")
    args = parser.parse_args()

    boundaries = json.loads(DATA_FILE.read_text())
    logger.info(f"{len(boundaries)} boundaries in {DATA_FILE.name}\n")

    applied = skipped = 0
    with get_db_cursor() as cursor:
        cursor.execute("SELECT id FROM organisation WHERE slug = %s", (args.org_slug,))
        row = cursor.fetchone()
        if not row:
            logger.error(f"No organisation with slug {args.org_slug!r}")
            sys.exit(1)
        org_id = row[0]

        for key, entry in sorted(boundaries.items()):
            cursor.execute(
                "SELECT id, boundary_geometry IS NOT NULL FROM location"
                " WHERE organisation_id = %s AND name = %s",
                (org_id, entry["name"]),
            )
            found = cursor.fetchone()
            if not found:
                logger.warning(f"  {entry['name']!r}: not found, skipping")
                skipped += 1
                continue
            location_id, had_boundary = found
            note = "replacing existing" if had_boundary else "new"
            flag = " (approximate)" if entry.get("approximate") else ""
            logger.info(f"  {entry['name']:28s} {entry['area_ha']:6.2f} ha  {note}{flag}")

            if args.dry_run:
                continue
            cursor.execute(
                """
                UPDATE location
                SET boundary_geometry = ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                    location_type = 'area'
                WHERE id = %s
                """,
                (json.dumps(entry["geometry"]), location_id),
            )
            applied += 1

        if args.dry_run:
            logger.info("\nDRY RUN complete. Re-run with --no-dry-run to apply.")
            return

        # Every polygon must be valid and simple once PostGIS has it.
        cursor.execute(
            """
            SELECT name, ST_IsValid(boundary_geometry),
                   ROUND((ST_Area(boundary_geometry::geography) / 10000.0)::numeric, 2)
            FROM location
            WHERE organisation_id = %s AND name = ANY(%s)
            ORDER BY name
            """,
            (org_id, [e["name"] for e in boundaries.values()]),
        )
        logger.info("\nStored geometry:")
        for name, valid, area in cursor.fetchall():
            logger.info(f"  {name:28s} valid={valid}  {area} ha")

    logger.info(f"\nApplied {applied}, skipped {skipped}.")


if __name__ == "__main__":
    main()
