"""
Clean up duplicate butterfly species records that differ only by hyphen vs space.

Finds species with type='butterfly' whose names normalize to the same value when
hyphens are treated as spaces and case is ignored (e.g. 'Orange-tip' and 'orange tip').
For each duplicate group:
  - The most recently created record is kept.
  - Older records have their sightings re-pointed to the kept record, then are
    deleted. Any audio/camera-trap detections referencing the older records are
    re-pointed too (defensive — butterflies are unlikely to appear in those tables).

Note: only the `name` column is used to detect duplicates. If an older record has
fields the newer record is missing (e.g. scientific_name, nbn_atlas_guid), those
values are lost on delete. Review the dry-run output before applying.

Usage:
    ./run <env> cleanup_duplicate_butterflies.py                     # Dry-run (preview only)
    ./run <env> cleanup_duplicate_butterflies.py --no-dry-run --yes  # Apply to database

<env> is one of: dev, staging, prod. Defaults to dry-run mode.
Use --no-dry-run to write to database. Use --yes to skip the confirmation prompt.
"""

import logging
import re
import sys
from collections import defaultdict
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db_cursor
from script_utils import get_arg_parser


logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


SPECIES_TYPE = 'butterfly'


def normalize(name: str) -> str:
    """Lower-case, treat hyphen as space, collapse whitespace."""
    return re.sub(r'\s+', ' ', name.replace('-', ' ').lower()).strip()


def find_duplicate_groups(cursor) -> list[dict]:
    """Group butterfly species by normalized name; return groups of size > 1.

    Within each group rows are sorted newest-first (created_at DESC, id DESC):
    the head is kept, the tail is dropped.
    """
    cursor.execute(
        """
        SELECT s.id, s.name, s.created_at
        FROM species s
        JOIN species_type st ON s.species_type_id = st.id
        WHERE st.name = %s AND s.name IS NOT NULL
        ORDER BY s.created_at DESC, s.id DESC
        """,
        (SPECIES_TYPE,),
    )

    by_norm: dict[str, list[dict]] = defaultdict(list)
    for sid, name, created_at in cursor.fetchall():
        by_norm[normalize(name)].append({'id': sid, 'name': name, 'created_at': created_at})

    groups = []
    for norm, rows in by_norm.items():
        if len(rows) > 1:
            groups.append({'norm': norm, 'keep': rows[0], 'drop': rows[1:]})
    return groups


def count_refs(cursor, species_id: int) -> dict[str, int]:
    """Count rows in each table that reference the given species."""
    counts = {}
    for table in ('sighting', 'audio_detection', 'camera_trap_detection'):
        cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE species_id = %s", (species_id,))
        counts[table] = cursor.fetchone()[0]
    return counts


def repoint(cursor, old_id: int, new_id: int) -> dict[str, int]:
    """Re-point all references from old_id to new_id; return per-table rowcounts."""
    counts = {}
    for table in ('sighting', 'audio_detection', 'camera_trap_detection'):
        cursor.execute(
            f"UPDATE {table} SET species_id = %s WHERE species_id = %s",
            (new_id, old_id),
        )
        counts[table] = cursor.rowcount
    return counts


def fmt_refs(refs: dict[str, int]) -> str:
    """Compact human-readable ref summary, e.g. '5 sightings, 1 audio'."""
    bits = [f"{refs['sighting']} sightings"]
    if refs['audio_detection']:
        bits.append(f"{refs['audio_detection']} audio")
    if refs['camera_trap_detection']:
        bits.append(f"{refs['camera_trap_detection']} camera")
    return ', '.join(bits)


def main(dry_run: bool, confirm: bool) -> int:
    logger.info(f"Running in {'DRY-RUN' if dry_run else 'LIVE'} mode (species_type={SPECIES_TYPE!r})")

    with get_db_cursor() as cursor:
        groups = find_duplicate_groups(cursor)

        if not groups:
            logger.info("No duplicate butterfly species found.")
            return 0

        # Annotate each row with its ref counts (for both preview and apply paths)
        for g in groups:
            for row in [g['keep']] + g['drop']:
                row['refs'] = count_refs(cursor, row['id'])

        # Concise per-group preview
        logger.info(f"Found {len(groups)} duplicate group(s):")
        total_drops = 0
        totals = {'sighting': 0, 'audio_detection': 0, 'camera_trap_detection': 0}
        for g in groups:
            keep = g['keep']
            logger.info(
                f"  [{g['norm']}] keep #{keep['id']} {keep['name']!r} "
                f"({keep['created_at']:%Y-%m-%d}, {fmt_refs(keep['refs'])})"
            )
            for d in g['drop']:
                logger.info(
                    f"    ← drop #{d['id']} {d['name']!r} "
                    f"({d['created_at']:%Y-%m-%d}, {fmt_refs(d['refs'])})"
                )
                total_drops += 1
                for k in totals:
                    totals[k] += d['refs'][k]

        summary = [f"{total_drops} species to delete", f"{totals['sighting']} sightings to repoint"]
        if totals['audio_detection']:
            summary.append(f"{totals['audio_detection']} audio detections")
        if totals['camera_trap_detection']:
            summary.append(f"{totals['camera_trap_detection']} camera trap detections")
        logger.info("Summary: " + ", ".join(summary))

        if dry_run:
            logger.info("Run with --no-dry-run --yes to apply.")
            return 0

        if not confirm:
            response = input("\nType 'yes' to confirm: ").strip().lower()
            if response != 'yes':
                logger.info("Aborted.")
                return 0

        # Apply: re-point every drop's references, then bulk-delete the drops.
        # The whole block runs in one transaction (committed on context-manager exit).
        drop_ids = []
        for g in groups:
            new_id = g['keep']['id']
            for d in g['drop']:
                rc = repoint(cursor, d['id'], new_id)
                logger.info(f"  #{d['id']} -> #{new_id}: repointed {fmt_refs(rc)}")
                drop_ids.append(d['id'])

        cursor.execute("DELETE FROM species WHERE id IN %s", (tuple(drop_ids),))
        logger.info(f"Deleted {cursor.rowcount} species record(s).")

    return 0


if __name__ == "__main__":
    parser = get_arg_parser(description=__doc__)
    parser.add_argument('--yes', action='store_true', help='Skip confirmation prompt')
    args = parser.parse_args()
    sys.exit(main(dry_run=args.dry_run, confirm=args.yes))
