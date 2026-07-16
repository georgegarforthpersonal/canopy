"""add location colour key column

Re-introduces a per-location colour as a single named palette key (the old
boundary_fill_color / boundary_stroke_color hex columns were dropped in
o0a1b2c3d4e5). Null means the fixed per-location_type default; the key→colour
mapping lives in the frontend palette.

Revision ID: loccol01
Revises: acct04
Create Date: 2026-07-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'loccol01'
down_revision: Union[str, Sequence[str], None] = 'acct04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('location', sa.Column('color', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('location', 'color')
