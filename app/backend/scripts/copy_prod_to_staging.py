"""
Copy production database to staging.

This script creates a complete copy of the production database (schema + data)
and restores it to staging, replacing all existing staging data.

WARNING: This is a destructive operation that will completely replace
the staging database contents.

Usage:
    python copy_prod_to_staging.py                           # Dry-run (preview only)
    python copy_prod_to_staging.py --no-dry-run --yes        # Apply copy
    python copy_prod_to_staging.py --skip-backup             # Skip staging backup (dangerous!)

Environment variables required (use migrate-run to set these):
    PROD_DB_HOST, PROD_DB_PORT, PROD_DB_NAME, PROD_DB_USER, PROD_DB_PASSWORD
    STAGING_DB_HOST, STAGING_DB_PORT, STAGING_DB_NAME, STAGING_DB_USER, STAGING_DB_PASSWORD

Note: For Neon databases, use the direct endpoint (not -pooler) for best results.
"""

import logging
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from script_utils import get_arg_parser


logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s'
)
logger = logging.getLogger(__name__)


def get_connection_params(prefix: str) -> dict:
    """
    Build connection parameters from prefixed environment variables.
    """
    required = ['HOST', 'PORT', 'NAME', 'USER', 'PASSWORD']
    params = {}
    missing = []

    for key in required:
        env_var = f"{prefix}_{key}"
        value = os.environ.get(env_var)
        if not value:
            missing.append(env_var)
        else:
            param_name = {
                'HOST': 'host',
                'PORT': 'port',
                'NAME': 'database',
                'USER': 'user',
                'PASSWORD': 'password'
            }[key]
            params[param_name] = value

    sslmode = os.environ.get(f"{prefix}_SSLMODE")
    if sslmode:
        params['sslmode'] = sslmode

    if missing:
        raise ValueError(f"Missing environment variables: {', '.join(missing)}")

    return params


def build_connection_string(prefix: str) -> str:
    """Build a PostgreSQL connection string for pg_dump/pg_restore."""
    params = get_connection_params(prefix)
    sslmode = params.get('sslmode', 'prefer')
    return (
        f"postgresql://{params['user']}:{params['password']}"
        f"@{params['host']}:{params['port']}/{params['database']}"
        f"?sslmode={sslmode}"
    )


def get_db_stats(prefix: str) -> dict:
    """Get basic stats about a database using psql."""
    import psycopg2
    params = get_connection_params(prefix)

    stats = {}
    try:
        conn = psycopg2.connect(**params)
        cursor = conn.cursor()

        # Get table count
        cursor.execute("""
            SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        """)
        stats['tables'] = cursor.fetchone()[0]

        # Get total row count across key tables
        for table in ['survey', 'sighting', 'species', 'surveyor', 'location']:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                stats[table] = cursor.fetchone()[0]
            except:
                stats[table] = 'N/A'

        conn.close()
    except Exception as e:
        logger.warning(f"Could not get stats for {prefix}: {e}")
        stats = {'error': str(e)}

    return stats


def backup_database(prefix: str, label: str) -> Path:
    """Backup database using pg_dump."""
    backups_dir = Path(__file__).parent / "data" / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = backups_dir / f"copy_{label}_{timestamp}.dump"

    connection_string = build_connection_string(prefix)

    cmd = [
        "pg_dump",
        "-Fc",  # Custom format
        "-v",   # Verbose
        "-f", str(output_path),
        connection_string
    ]

    logger.info(f"Backing up {label} database to {output_path}...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        logger.error(f"pg_dump failed for {label}: {result.stderr}")
        raise RuntimeError(f"Backup failed for {label} database")

    size_bytes = output_path.stat().st_size
    if size_bytes < 1024:
        size_str = f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        size_str = f"{size_bytes / 1024:.1f} KB"
    else:
        size_str = f"{size_bytes / (1024 * 1024):.1f} MB"

    logger.info(f"Backup complete: {output_path} ({size_str})")
    return output_path


def dump_prod() -> Path:
    """Create a full dump of production database (public schema only)."""
    backups_dir = Path(__file__).parent / "data" / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = backups_dir / f"prod_full_{timestamp}.dump"

    connection_string = build_connection_string('PROD_DB')

    cmd = [
        "pg_dump",
        "-Fc",           # Custom format
        "-v",            # Verbose
        "--schema=public",  # Only dump public schema (not neon_auth, etc.)
        "--no-owner",    # Don't include ownership commands
        "--no-acl",      # Don't include access privileges
        "-f", str(output_path),
        connection_string
    ]

    logger.info(f"Dumping production database to {output_path}...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        logger.error(f"pg_dump failed: {result.stderr}")
        raise RuntimeError("Failed to dump production database")

    size_bytes = output_path.stat().st_size
    if size_bytes < 1024 * 1024:
        size_str = f"{size_bytes / 1024:.1f} KB"
    else:
        size_str = f"{size_bytes / (1024 * 1024):.1f} MB"

    logger.info(f"Dump complete: {output_path} ({size_str})")
    return output_path


def drop_staging_schema() -> None:
    """Drop all objects in the staging public schema."""
    import psycopg2
    params = get_connection_params('STAGING_DB')

    logger.info("Dropping all objects in staging public schema...")

    conn = psycopg2.connect(**params)
    conn.autocommit = True  # DDL commands need autocommit
    cursor = conn.cursor()

    try:
        # Drop and recreate public schema (cleanest way to remove everything)
        cursor.execute("DROP SCHEMA public CASCADE")
        cursor.execute("CREATE SCHEMA public")
        cursor.execute("GRANT ALL ON SCHEMA public TO PUBLIC")
        # Re-resolve search_path: dropping public invalidates the OIDs the
        # session cached at connect time, otherwise CREATE EXTENSION below
        # fails with "no schema has been selected to create in".
        cursor.execute("SET search_path TO public")
        logger.info("  Dropped and recreated public schema")

        # Enable PostGIS extension (required for geometry columns)
        cursor.execute("CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public")
        logger.info("  Enabled PostGIS extension")
    finally:
        cursor.close()
        conn.close()


def restore_to_staging(dump_path: Path) -> None:
    """Restore dump to staging database."""
    connection_string = build_connection_string('STAGING_DB')

    cmd = [
        "pg_restore",
        "-v",            # Verbose
        "--no-owner",    # Don't try to set ownership
        "--no-acl",      # Don't restore access privileges
        "-d", connection_string,
        str(dump_path)
    ]

    logger.info("Restoring to staging database...")
    logger.info("This may take a moment...")

    result = subprocess.run(cmd, capture_output=True, text=True)

    # pg_restore may return non-zero even on success due to warnings
    if result.returncode != 0:
        # Filter out harmless warnings
        errors = [line for line in result.stderr.split('\n')
                  if 'ERROR' in line
                  and 'does not exist' not in line
                  and 'transaction_timeout' not in line
                  and 'neon_auth' not in line
                  and 'schema "public" already exists' not in line]
        if errors:
            logger.error(f"pg_restore encountered errors:")
            for error in errors[:10]:
                logger.error(f"  {error}")
            raise RuntimeError("Restore failed with errors")
        else:
            logger.info("Restore completed (with expected warnings)")
    else:
        logger.info("Restore completed successfully")


def run_copy(dry_run: bool, skip_backup: bool, yes: bool) -> int:
    """Main copy orchestration."""
    mode = "DRY RUN" if dry_run else "LIVE"

    logger.info("")
    logger.info("=" * 80)
    logger.info("=" * 80)
    logger.info("   COPY PRODUCTION TO STAGING")
    logger.info(f"   Mode: {mode}")
    logger.info("=" * 80)
    logger.info("=" * 80)

    if not dry_run:
        logger.warning("")
        logger.warning("   *** WARNING: THIS WILL REPLACE ALL STAGING DATA ***")
        logger.warning("")

    # 1. Validate environment
    try:
        get_connection_params('PROD_DB')
        get_connection_params('STAGING_DB')
    except ValueError as e:
        logger.error(str(e))
        logger.error("\nMake sure to run this script using ./migrate-run")
        return 1

    # 2. Get database stats for preview
    logger.info("\nGathering database information...")

    prod_stats = get_db_stats('PROD_DB')
    staging_stats = get_db_stats('STAGING_DB')

    logger.info("\n" + "=" * 80)
    logger.info("DATABASE COMPARISON")
    logger.info("=" * 80)

    logger.info("\nPRODUCTION (source):")
    if 'error' not in prod_stats:
        logger.info(f"  Tables: {prod_stats.get('tables', 'N/A')}")
        logger.info(f"  Surveys: {prod_stats.get('survey', 'N/A')}")
        logger.info(f"  Sightings: {prod_stats.get('sighting', 'N/A')}")
        logger.info(f"  Species: {prod_stats.get('species', 'N/A')}")
        logger.info(f"  Surveyors: {prod_stats.get('surveyor', 'N/A')}")
        logger.info(f"  Locations: {prod_stats.get('location', 'N/A')}")
    else:
        logger.error(f"  Could not connect: {prod_stats['error']}")
        return 1

    logger.info("\nSTAGING (destination - will be replaced):")
    if 'error' not in staging_stats:
        logger.info(f"  Tables: {staging_stats.get('tables', 'N/A')}")
        logger.info(f"  Surveys: {staging_stats.get('survey', 'N/A')}")
        logger.info(f"  Sightings: {staging_stats.get('sighting', 'N/A')}")
        logger.info(f"  Species: {staging_stats.get('species', 'N/A')}")
        logger.info(f"  Surveyors: {staging_stats.get('surveyor', 'N/A')}")
        logger.info(f"  Locations: {staging_stats.get('location', 'N/A')}")
    else:
        logger.error(f"  Could not connect: {staging_stats['error']}")
        return 1

    logger.info("\n" + "=" * 80)
    logger.info("OPERATION PLAN")
    logger.info("=" * 80)
    if not skip_backup:
        logger.info("1. Backup staging database")
    else:
        logger.info("1. [SKIPPED] Backup staging database")
    logger.info("2. Dump production database (schema + data)")
    logger.info("3. Drop staging public schema (clean slate)")
    logger.info("4. Enable PostGIS extension in staging")
    logger.info("5. Restore production dump to staging")
    logger.info("")
    logger.info("After this operation:")
    logger.info("  - Staging will have the SAME schema as production")
    logger.info("  - Staging will have the SAME data as production")
    logger.info("  - All existing staging data will be GONE")

    if dry_run:
        logger.info("\n" + "=" * 80)
        logger.info("DRY RUN complete. Run with --no-dry-run to apply.")
        logger.info("=" * 80)
        return 0

    # 3. Confirm
    if not yes:
        logger.info("\n" + "=" * 80)
        logger.warning("THIS WILL PERMANENTLY REPLACE STAGING DATA!")
        logger.info("=" * 80)
        response = input("\nType 'yes' to confirm: ").strip().lower()
        if response != 'yes':
            logger.info("Aborted.")
            return 0

    # 4. Backup staging
    if not skip_backup:
        logger.info("\n" + "-" * 80)
        logger.info("Step 1: Backing up staging...")
        logger.info("-" * 80)
        try:
            staging_backup = backup_database('STAGING_DB', 'staging_before_copy')
            logger.info(f"Staging backed up to: {staging_backup}")
        except RuntimeError as e:
            logger.error(f"Backup failed: {e}")
            return 1
    else:
        logger.warning("\nSkipping staging backup (--skip-backup)")

    # 5. Dump prod
    logger.info("\n" + "-" * 80)
    logger.info("Step 2: Dumping production database...")
    logger.info("-" * 80)
    try:
        prod_dump = dump_prod()
    except RuntimeError as e:
        logger.error(f"Dump failed: {e}")
        return 1

    # 6. Drop staging schema and restore
    logger.info("\n" + "-" * 80)
    logger.info("Step 3: Dropping staging schema and restoring...")
    logger.info("-" * 80)
    try:
        drop_staging_schema()
        restore_to_staging(prod_dump)
    except RuntimeError as e:
        logger.error(f"Restore failed: {e}")
        logger.error("Staging may be in an inconsistent state!")
        logger.error(f"You can restore from backup if needed")
        return 1

    # 7. Verify
    logger.info("\n" + "-" * 80)
    logger.info("Verifying staging...")
    logger.info("-" * 80)
    new_staging_stats = get_db_stats('STAGING_DB')

    if 'error' not in new_staging_stats:
        logger.info(f"  Surveys: {new_staging_stats.get('survey', 'N/A')}")
        logger.info(f"  Sightings: {new_staging_stats.get('sighting', 'N/A')}")
        logger.info(f"  Species: {new_staging_stats.get('species', 'N/A')}")

        # Compare with prod
        if (new_staging_stats.get('survey') == prod_stats.get('survey') and
            new_staging_stats.get('sighting') == prod_stats.get('sighting')):
            logger.info("\n  Counts match production - copy successful!")
        else:
            logger.warning("\n  Counts differ from production - please verify manually")
    else:
        logger.warning(f"  Could not verify: {new_staging_stats['error']}")

    logger.info("\n" + "=" * 80)
    logger.info("COPY COMPLETE!")
    logger.info("=" * 80)
    logger.info(f"\nStaging now mirrors production.")
    if not skip_backup:
        logger.info(f"Original staging backed up to: {staging_backup}")

    return 0


def main():
    parser = get_arg_parser(description=__doc__)
    parser.add_argument(
        '--yes', '-y',
        action='store_true',
        help='Skip confirmation prompt'
    )
    parser.add_argument(
        '--skip-backup',
        action='store_true',
        help='Skip staging backup (DANGEROUS!)'
    )
    args = parser.parse_args()

    try:
        exit_code = run_copy(
            dry_run=args.dry_run,
            skip_backup=args.skip_backup,
            yes=args.yes
        )
        sys.exit(exit_code)
    except KeyboardInterrupt:
        logger.info("\nAborted by user.")
        sys.exit(1)
    except Exception as e:
        logger.exception(f"Copy failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
