"""drop location boundary colour columns

Location map colours are now fixed per location_type in the frontend, so the
per-location boundary_fill_color / boundary_stroke_color / boundary_fill_opacity
columns are redundant.

Revision ID: o0a1b2c3d4e5
Revises: n9f0a1b2c3d4
Create Date: 2026-06-19

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'o0a1b2c3d4e5'
down_revision: Union[str, Sequence[str], None] = 'n9f0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE location
        DROP COLUMN IF EXISTS boundary_fill_color,
        DROP COLUMN IF EXISTS boundary_stroke_color,
        DROP COLUMN IF EXISTS boundary_fill_opacity;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE location
        ADD COLUMN boundary_fill_color VARCHAR(7) DEFAULT '#3388ff',
        ADD COLUMN boundary_stroke_color VARCHAR(7) DEFAULT '#3388ff',
        ADD COLUMN boundary_fill_opacity REAL DEFAULT 0.2;
    """)
