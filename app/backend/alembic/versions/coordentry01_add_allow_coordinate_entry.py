"""Add allow_coordinate_entry to survey_type table

Revision ID: coordentry01
Revises: loccol01
Create Date: 2026-07-20

Adds toggle for precise sighting-location entry (typed lat/lng) in the
location picker. Off by default; enabled per survey type (e.g. marsh
fritillary larval webs).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'coordentry01'
down_revision: Union[str, None] = 'loccol01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add allow_coordinate_entry column to survey_type table."""
    op.add_column('survey_type', sa.Column('allow_coordinate_entry', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    """Remove allow_coordinate_entry column from survey_type table."""
    op.drop_column('survey_type', 'allow_coordinate_entry')
