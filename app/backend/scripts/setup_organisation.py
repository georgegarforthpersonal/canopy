#!/usr/bin/env python3
"""
Setup a new organisation from a config file.

This script creates an organisation and its locations from a JSON config file.
Config files should be placed in scripts/data/.

Usage:
    ./dev-run setup_organisation.py scripts/data/cannwood_config.json              # Dry-run (preview only)
    ./dev-run setup_organisation.py scripts/data/cannwood_config.json --no-dry-run # Apply to database
    ./dev-run setup_organisation.py scripts/data/cannwood_config.json --no-dry-run --update  # Update existing locations

Defaults to dry-run mode. Use --no-dry-run to write to database.
Use --update to update existing locations instead of skipping them.

Config file structure:
{
  "organisation": {
    "name": "Org Name",
    "slug": "org-slug"
  },
  "locations": [
    {
      "name": "Location Name",
      "boundary_geometry": [[lng, lat], ...]   // Optional
    }
  ]
}
"""

import argparse
import json
import logging
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from database.connection import get_engine


logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s'
)
logger = logging.getLogger(__name__)


def setup_organisation(config_path: str, dry_run: bool = True, update: bool = False):
    """
    Create an organisation and its locations from a config file.

    Args:
        config_path: Path to the JSON config file
        dry_run: If True, preview changes without applying
        update: If True, update existing locations instead of skipping them
    """
    # Load config
    config_file = Path(config_path)
    if not config_file.exists():
        logger.error(f"Config file not found: {config_path}")
        sys.exit(1)

    with open(config_file, 'r') as f:
        config = json.load(f)

    org_config = config['organisation']
    locations = config.get('locations', [])

    # Validate required fields
    required_fields = ['name', 'slug']
    for field in required_fields:
        if field not in org_config:
            logger.error(f"Missing required field: organisation.{field}")
            sys.exit(1)

    if dry_run:
        logger.info("DRY RUN - No changes will be made to the database")
        logger.info("")

    engine = get_engine()

    with engine.connect() as conn:
        # Check if organisation already exists
        result = conn.execute(
            text("SELECT id FROM organisation WHERE slug = :slug"),
            {"slug": org_config['slug']}
        ).fetchone()

        if result:
            org_id = result[0]
            logger.info(f"Organisation '{org_config['slug']}' already exists with id={org_id}")
            logger.info("Skipping organisation creation, will check for new locations.")
        else:
            logger.info(f"Creating organisation: {org_config['name']}")
            logger.info(f"  slug: {org_config['slug']}")

            if dry_run:
                org_id = 999  # Placeholder for dry run
                logger.info("  [DRY RUN] Would create organisation")
            else:
                result = conn.execute(
                    text("""
                        INSERT INTO organisation (name, slug, is_active)
                        VALUES (:name, :slug, true)
                        RETURNING id
                    """),
                    {
                        "name": org_config['name'],
                        "slug": org_config['slug'],
                    }
                )
                org_id = result.fetchone()[0]
                logger.info(f"  Created with id={org_id}")

        # Create locations
        logger.info("")
        logger.info(f"Processing {len(locations)} location(s)...")

        for loc in locations:
            if 'name' not in loc:
                logger.warning(f"Skipping location without name: {loc}")
                continue

            # Build geometry SQL if boundary provided
            boundary_geometry = loc.get('boundary_geometry')
            if boundary_geometry:
                # Close the polygon if not already closed
                if boundary_geometry[0] != boundary_geometry[-1]:
                    boundary_geometry.append(boundary_geometry[0])

                coords_str = ', '.join([f"{p[0]} {p[1]}" for p in boundary_geometry])
                geometry_sql = f"ST_GeomFromText('POLYGON(({coords_str}))', 4326)"
            else:
                geometry_sql = "NULL"

            # Check if location already exists for this org
            existing = None
            if not dry_run or result:  # Can only check if org exists
                existing = conn.execute(
                    text("""
                        SELECT id FROM location
                        WHERE name = :name AND organisation_id = :org_id
                    """),
                    {"name": loc['name'], "org_id": org_id}
                ).fetchone()

            if existing:
                if not update:
                    logger.info(f"  Location '{loc['name']}' already exists, skipping (use --update to update)")
                    continue

                logger.info(f"  Updating location: {loc['name']}")
                if boundary_geometry:
                    logger.info(f"    With boundary ({len(boundary_geometry)} points)")
                else:
                    logger.info("    No boundary geometry")

                if dry_run:
                    logger.info("    [DRY RUN] Would update location")
                else:
                    conn.execute(
                        text(f"""
                            UPDATE location
                            SET boundary_geometry = {geometry_sql},
                                location_type = :location_type
                            WHERE id = :location_id
                        """),
                        {
                            "location_id": existing[0],
                            "location_type": 'area' if boundary_geometry else 'none',
                        }
                    )
                    logger.info("    Updated")
            else:
                logger.info(f"  Creating location: {loc['name']}")
                if boundary_geometry:
                    logger.info(f"    With boundary ({len(boundary_geometry)} points)")
                else:
                    logger.info("    No boundary geometry")

                if dry_run:
                    logger.info("    [DRY RUN] Would create location")
                else:
                    conn.execute(
                        text(f"""
                            INSERT INTO location (
                                name, organisation_id, boundary_geometry, location_type
                            )
                            VALUES (
                                :name, :org_id, {geometry_sql}, :location_type
                            )
                        """),
                        {
                            "name": loc['name'],
                            "org_id": org_id,
                            "location_type": 'area' if boundary_geometry else 'none',
                        }
                    )
                    logger.info("    Created")

        if not dry_run:
            conn.commit()

    logger.info("")
    if dry_run:
        logger.info("DRY RUN complete. Use --no-dry-run to apply changes.")
    else:
        logger.info("Organisation setup complete!")
        logger.info("")
        logger.info("Next steps:")
        logger.info(f"  1. Point the {org_config['slug']}.canopydata.app domain at the frontend service")
        logger.info(f"  2. Bootstrap the first admin: python scripts/create_admin.py --org {org_config['slug']} --email ...")
        logger.info(f"  3. Log in and create survey types from the frontend")


def main():
    parser = argparse.ArgumentParser(
        description='Setup a new organisation from a config file.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    ./dev-run setup_organisation.py scripts/data/cannwood_config.json
    ./dev-run setup_organisation.py scripts/data/cannwood_config.json --no-dry-run
    ./dev-run setup_organisation.py scripts/data/cannwood_config.json --no-dry-run --update
        """
    )
    parser.add_argument(
        'config_file',
        help='Path to the JSON config file (e.g., scripts/data/cannwood_config.json)'
    )
    parser.add_argument(
        '--no-dry-run',
        action='store_true',
        help='Actually apply changes to the database (default is dry-run)'
    )
    parser.add_argument(
        '--update',
        action='store_true',
        help='Update existing locations instead of skipping them'
    )

    args = parser.parse_args()

    setup_organisation(args.config_file, dry_run=not args.no_dry_run, update=args.update)


if __name__ == '__main__':
    main()
