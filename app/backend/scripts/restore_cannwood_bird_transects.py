"""
Restore the three Cannwood bird transect routes deleted from prod.

Red route (103), Blue Route (104) and Green Route (105) were drawn in the
admin map on 16 Jul 2026, linked to the Bird survey type, and later
hard-deleted (location delete has no soft-delete). Their rows were recovered
from scripts/data/backups/prod_full_20260721_173054.dump and saved to
scripts/data/cannwood_bird_transects.json (original ids, created_at, colour
and EWKB geometry).

This script re-inserts the three location rows with their original ids and
re-links them to the Bird survey type. Safe to re-run: existing ids and
existing links are skipped.

Usage:
    docker compose --profile prod run --rm scripts-prod bash -c \
        "cd /app && PYTHONPATH=/app python scripts/restore_cannwood_bird_transects.py"            # dry run
    docker compose --profile prod run --rm scripts-prod bash -c \
        "cd /app && PYTHONPATH=/app python scripts/restore_cannwood_bird_transects.py --no-dry-run"
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db_cursor
from script_utils import get_arg_parser
from script_utils.arg_parser import log_dry_run_mode

DATA_FILE = Path(__file__).parent / "data" / "cannwood_bird_transects.json"

CANNWOOD_ORG_ID = 2
BIRD_SURVEY_TYPE_ID = 6


def main() -> None:
    parser = get_arg_parser(description=__doc__)
    args = parser.parse_args()
    log_dry_run_mode(args)

    routes = json.loads(DATA_FILE.read_text())

    with get_db_cursor() as cur:
        cur.execute("SELECT name FROM organisation WHERE id = %s", (CANNWOOD_ORG_ID,))
        org = cur.fetchone()
        cur.execute(
            "SELECT name, organisation_id FROM survey_type WHERE id = %s",
            (BIRD_SURVEY_TYPE_ID,),
        )
        st = cur.fetchone()
        if not org or org[0] != "Cannwood":
            sys.exit(f"Org {CANNWOOD_ORG_ID} is not Cannwood (got {org}); aborting")
        if not st or st[0] != "Bird" or st[1] != CANNWOOD_ORG_ID:
            sys.exit(f"Survey type {BIRD_SURVEY_TYPE_ID} is not Cannwood's Bird (got {st}); aborting")

        for r in routes:
            cur.execute("SELECT name FROM location WHERE id = %s", (r["id"],))
            existing = cur.fetchone()
            if existing:
                print(f"  location {r['id']} already exists ({existing[0]}), skipping insert")
            elif args.dry_run:
                print(f"  would insert location {r['id']} '{r['name']}' (route, color={r['color']})")
            else:
                cur.execute(
                    """
                    INSERT INTO location
                        (id, name, created_at, boundary_geometry, organisation_id,
                         location_type, color)
                    VALUES (%s, %s, %s, %s, %s, 'route', %s)
                    """,
                    (r["id"], r["name"], r["created_at"], r["geometry_ewkb_hex"],
                     CANNWOOD_ORG_ID, r["color"]),
                )
                print(f"  inserted location {r['id']} '{r['name']}'")

            cur.execute(
                "SELECT 1 FROM survey_type_location WHERE survey_type_id = %s AND location_id = %s",
                (BIRD_SURVEY_TYPE_ID, r["id"]),
            )
            if cur.fetchone():
                print(f"  Bird link for location {r['id']} already exists, skipping")
            elif args.dry_run:
                print(f"  would link location {r['id']} to Bird survey type")
            else:
                cur.execute(
                    "INSERT INTO survey_type_location (survey_type_id, location_id) VALUES (%s, %s)",
                    (BIRD_SURVEY_TYPE_ID, r["id"]),
                )
                print(f"  linked location {r['id']} to Bird survey type")

        if not args.dry_run:
            # Explicit-id inserts bypass the sequence; keep it ahead of max(id).
            cur.execute(
                """
                SELECT setval(pg_get_serial_sequence('location', 'id'),
                              (SELECT max(id) FROM location))
                """
            )
            print(f"  location id sequence set to {cur.fetchone()[0]}")

            cur.execute(
                """
                SELECT l.id, l.name, l.location_type, l.color,
                       ST_NPoints(l.boundary_geometry::geometry)
                FROM location l
                JOIN survey_type_location stl ON stl.location_id = l.id
                WHERE stl.survey_type_id = %s
                ORDER BY l.id
                """,
                (BIRD_SURVEY_TYPE_ID,),
            )
            print("\nBird survey type locations now:")
            for row in cur.fetchall():
                print("  ", row)


if __name__ == "__main__":
    main()
