"""add location sectors (sub-segments of a route)

Sectors are modelled as child ``location`` rows (location_type == 'sector')
pointing at their parent route:

- ``parent_location_id`` — self-referential FK to ``location.id`` (CASCADE on
  delete), NULL for all top-level locations.
- ``ordinal`` — 1-based ordering of sectors within a route, NULL for non-sectors.

Revision ID: sector01
Revises: survstatus01
Create Date: 2026-07-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'sector01'
down_revision: Union[str, Sequence[str], None] = 'survstatus01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'location',
        sa.Column('parent_location_id', sa.Integer(), nullable=True),
    )
    op.add_column(
        'location',
        sa.Column('ordinal', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_location_parent_location_id',
        'location', 'location',
        ['parent_location_id'], ['id'],
        ondelete='CASCADE',
    )
    op.create_index(
        'ix_location_parent_location_id',
        'location', ['parent_location_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_location_parent_location_id', table_name='location')
    op.drop_constraint('fk_location_parent_location_id', 'location', type_='foreignkey')
    op.drop_column('location', 'ordinal')
    op.drop_column('location', 'parent_location_id')
