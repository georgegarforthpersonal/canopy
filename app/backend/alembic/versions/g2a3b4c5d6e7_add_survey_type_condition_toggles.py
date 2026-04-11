"""Add condition and description toggles to survey_type table

Revision ID: g2a3b4c5d6e7
Revises: f1a2b3c4d5e6
Create Date: 2026-04-11

Adds toggle columns to control visibility of survey condition fields
(start/end time, sun percentage, temperature) and description display.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'g2a3b4c5d6e7'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add condition and description toggle columns to survey_type table."""
    op.add_column('survey_type', sa.Column('allow_start_end_time', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('survey_type', sa.Column('allow_sun_percentage', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('survey_type', sa.Column('allow_temperature', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('survey_type', sa.Column('allow_show_description', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    """Remove condition and description toggle columns from survey_type table."""
    op.drop_column('survey_type', 'allow_show_description')
    op.drop_column('survey_type', 'allow_temperature')
    op.drop_column('survey_type', 'allow_sun_percentage')
    op.drop_column('survey_type', 'allow_start_end_time')
