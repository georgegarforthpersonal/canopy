"""Drop the unique index on surveyor names

Revision ID: acct03
Revises: acct02
Create Date: 2026-07-10

Self sign-up deliberately creates a fresh user-linked surveyor rather than
name-matching against historical rows (a wrong match silently mis-attributes
someone's survey history; a duplicate is visible and merged deliberately by
an admin). That requires duplicate names to be *allowed* at the DB level —
in prod, most invited volunteers already exist as historical surveyors, so
the unique index made every first sign-up fail.

Accidental duplicates from the admin forms are still rejected by the
app-level check in routers/surveyors.py (409), which predates this and does
not rely on the index.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'acct03'
down_revision: Union[str, Sequence[str], None] = 'acct02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('ix_surveyor_name_unique', table_name='surveyor')


def downgrade() -> None:
    # Fails if duplicate names exist by then — merge duplicates first.
    op.execute("""
        CREATE UNIQUE INDEX ix_surveyor_name_unique
        ON surveyor (organisation_id, LOWER(first_name), LOWER(COALESCE(last_name, '')))
    """)
