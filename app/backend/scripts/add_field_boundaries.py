"""
Add field boundaries to survey locations.

This script adds polygon boundaries directly to location records for display on maps.
Boundaries are read from scripts/data/field_coordinates.json.

Each boundary in the JSON has a "name" field that identifies the location to update.

Usage:
    ./dev-run add_field_boundaries.py              # Dry-run (preview only)
    ./dev-run add_field_boundaries.py --no-dry-run # Apply to database

Defaults to dry-run mode. Use --no-dry-run to write to database.
"""

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db_cursor


logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# FIELD BOUNDARY DEFINITIONS
# =============================================================================
# Boundaries are loaded from: scripts/data/field_coordinates.json
#
# Expected JSON structure (list of boundaries):
#   [
#       {
#           "name": "Location Name",        # Must match a location in the database
#           "coordinates": [[[lng, lat], [lng, lat], ...]],  # GeoJSON polygon
#           "fill_color": "#3388ff",        # Optional
#           "stroke_color": "#3388ff",      # Optional
#           "fill_opacity": 0.2             # Optional
#       },
#       ...
#   ]
#
# Note: Coordinates are in GeoJSON polygon format [[[lng, lat], ...]].
# Each location can have only one boundary (1:1 relationship).
# =============================================================================

DATA_FILE = Path(__file__).parent / "data" / "field_coordinates.json"


def load_boundaries() -> list:
    """Load boundaries from the JSON data file."""
    if not DATA_FILE.exists():
        logger.error(f"Data file not found: {DATA_FILE}")
        return []

    try:
        with open(DATA_FILE, 'r') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {DATA_FILE}: {e}")
        return []


BOUNDARIES = load_boundaries()


def get_location_info(location_name: str) -> Optional[dict]:
    """Look up location by name, including existing boundary info."""
    with get_db_cursor() as cursor:
        cursor.execute("""
            SELECT id, name, boundary_geometry IS NOT NULL as has_boundary
            FROM location WHERE name = %s
        """, (location_name,))
        result = cursor.fetchone()
        if result:
            return {"id": result[0], "name": result[1], "has_boundary": result[2]}
        return None


def preview_boundaries():
    """Preview what would be updated."""
    logger.info("\n" + "=" * 80)
    logger.info("FIELD BOUNDARIES PREVIEW")
    logger.info("=" * 80)

    if not BOUNDARIES:
        logger.warning("\nNo boundaries found in data file!")
        return False

    total_count = 0
    valid_count = 0
    will_update = 0
    will_add = 0

    for boundary in BOUNDARIES:
        location_name = boundary.get("name", "Unnamed")
        location_info = get_location_info(location_name)

        logger.info(f"\n📍 Location: {location_name}")
        if location_info:
            logger.info(f"   ID: {location_info['id']}")
            if location_info['has_boundary']:
                logger.info(f"   ⚠️  Has existing boundary - will be REPLACED")
                will_update += 1
            else:
                logger.info(f"   ✓ No existing boundary - will be ADDED")
                will_add += 1
            valid_count += 1
        else:
            logger.warning(f"   ⚠️  Location not found in database - will be SKIPPED")

        coords = boundary.get("coordinates", [[]])[0]  # GeoJSON polygon format
        fill_color = boundary.get("fill_color", "#3388ff")
        stroke_color = boundary.get("stroke_color", "#3388ff")
        fill_opacity = boundary.get("fill_opacity", 0.2)

        logger.info(f"   Coordinates: {len(coords)} points")
        if coords:
            logger.info(f"   First point: [{coords[0][0]:.6f}, {coords[0][1]:.6f}]")
            logger.info(f"   Last point:  [{coords[-1][0]:.6f}, {coords[-1][1]:.6f}]")
        logger.info(f"   Fill: {fill_color} ({fill_opacity * 100:.0f}% opacity)")
        logger.info(f"   Stroke: {stroke_color}")
        total_count += 1

    logger.info("\n" + "-" * 80)
    logger.info(f"Total: {total_count} boundaries")
    logger.info(f"Valid (location exists): {valid_count}")
    logger.info(f"  - Will add new: {will_add}")
    logger.info(f"  - Will replace existing: {will_update}")
    logger.info("=" * 80 + "\n")

    return valid_count > 0


def add_boundaries(dry_run: bool = True) -> bool:
    """Add boundaries to location records in the database."""

    if dry_run:
        success = preview_boundaries()
        if success:
            logger.info("\n" + "=" * 80)
            logger.info("DRY-RUN MODE - No changes made to database")
            logger.info("=" * 80)
            logger.info("To apply these changes, run with --no-dry-run flag.")
            logger.info("=" * 80 + "\n")
        return success

    # Live mode
    if not BOUNDARIES:
        logger.error("No boundaries found in data file!")
        return False

    # Preview first
    preview_boundaries()

    # Confirmation
    logger.info("\n" + "=" * 80)
    logger.info("⚠️  FINAL CONFIRMATION REQUIRED")
    logger.info("=" * 80)
    logger.info("You are about to UPDATE location records with boundary data.")
    logger.info("Existing boundaries will be REPLACED.")
    logger.info("=" * 80)

    response = input("\nType 'yes' to confirm and proceed: ").strip().lower()
    if response != 'yes':
        logger.info("\n✗ Import cancelled by user")
        return False

    # Update locations with boundaries
    logger.info("\n" + "=" * 80)
    logger.info("UPDATING LOCATIONS WITH BOUNDARIES")
    logger.info("=" * 80)

    try:
        with get_db_cursor() as cursor:
            updated_count = 0
            skipped_locations = []

            for boundary in BOUNDARIES:
                location_name = boundary.get("name", "Unnamed")
                location_info = get_location_info(location_name)

                if not location_info:
                    skipped_locations.append(location_name)
                    logger.warning(f"⚠️  Skipping '{location_name}' - location not found")
                    continue

                coords = boundary.get("coordinates", [])

                if not coords:
                    logger.warning(f"⚠️  Skipping '{location_name}' - no coordinates")
                    continue

                # Create GeoJSON polygon (coordinates already in GeoJSON format)
                geojson = json.dumps({
                    "type": "Polygon",
                    "coordinates": coords
                })

                # Update location with boundary
                cursor.execute("""
                    UPDATE location
                    SET
                        boundary_geometry = ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                        location_type = 'area'
                    WHERE id = %s
                """, (
                    geojson,
                    location_info['id']
                ))
                updated_count += 1
                action = "Updated" if location_info['has_boundary'] else "Added"
                logger.info(f"✓ {action} boundary for '{location_name}'")

            logger.info("\n" + "=" * 80)
            logger.info("✓ BOUNDARIES UPDATED SUCCESSFULLY")
            logger.info("=" * 80)
            logger.info(f"Updated: {updated_count} locations")
            if skipped_locations:
                logger.info(f"Skipped (not found): {', '.join(skipped_locations)}")
            logger.info("=" * 80 + "\n")

            return True

    except Exception as e:
        logger.error(f"\n✗ Failed to update boundaries: {e}")
        logger.error("All changes have been rolled back.")
        raise


def main(dry_run: bool = True):
    """Main script execution."""
    try:
        # Print mode banner
        if dry_run:
            logger.info("\n" + "=" * 80)
            logger.info("DRY-RUN MODE (Default)")
            logger.info("=" * 80)
            logger.info("No database changes will be made.")
            logger.info("This is a safe preview of what would happen.")
            logger.info("Use --no-dry-run to apply changes to the database.")
            logger.info("=" * 80 + "\n")
        else:
            logger.info("\n" + "=" * 80)
            logger.info("⚠️  LIVE MODE - DATABASE WRITES ENABLED")
            logger.info("=" * 80)
            logger.info("This will make changes to the database!")
            logger.info("Confirmation will be required.")
            logger.info("=" * 80 + "\n")

        success = add_boundaries(dry_run)
        return 0 if success else 1

    except KeyboardInterrupt:
        logger.info("\n\n✗ Interrupted by user (Ctrl+C)\n")
        return 1
    except Exception as e:
        logger.error(f"\n✗ Error: {e}", exc_info=True)
        return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--no-dry-run',
        dest='dry_run',
        action='store_false',
        default=True,
        help='Actually write to the database (default: dry-run only)'
    )
    args = parser.parse_args()

    exit_code = main(dry_run=args.dry_run)
    sys.exit(exit_code)
