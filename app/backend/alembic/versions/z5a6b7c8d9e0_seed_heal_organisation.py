"""Seed Heal organisation and backfill existing data

Revision ID: z5a6b7c8d9e0
Revises: y4z5a6b7c8d9
Create Date: 2026-02-18

This migration:
1. Creates the 'Heal' organisation with the current admin password
2. Backfills all existing data with organisation_id = 1
"""
from typing import Sequence, Union
import os

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'z5a6b7c8d9e0'
down_revision: Union[str, None] = 'y4z5a6b7c8d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Seed Heal organisation and backfill data."""
    # Historical note: this originally required a real ADMIN_PASSWORD for the
    # shared-password auth. That system is gone (the column is dropped by
    # acct02), so fresh databases just seed a placeholder that nothing reads.
    admin_password = os.getenv('ADMIN_PASSWORD', 'removed-by-acct02')

    # Insert Heal organisation with plaintext password
    op.execute(
        sa.text("""
            INSERT INTO organisation (name, slug, domain, admin_password, is_active)
            VALUES ('Heal', 'heal', 'healdata.up.railway.app', :admin_password, true)
        """).bindparams(admin_password=admin_password)
    )

    # Backfill all existing data with organisation_id = 1 (Heal)
    tables = ['survey', 'surveyor', 'location', 'survey_type']
    for table in tables:
        op.execute(f"UPDATE {table} SET organisation_id = 1 WHERE organisation_id IS NULL")


def downgrade() -> None:
    """Remove Heal organisation and clear backfilled data."""
    # Clear organisation_id from all tables (set back to NULL)
    tables = ['survey', 'surveyor', 'location', 'survey_type']
    for table in tables:
        op.execute(f"UPDATE {table} SET organisation_id = NULL WHERE organisation_id = 1")

    # Delete Heal organisation
    op.execute("DELETE FROM organisation WHERE slug = 'heal'")
