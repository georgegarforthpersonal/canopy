"""Add weather snapshot to surveys

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-04-03

Adds fetch_weather flag to survey_type and weather_snapshot JSONB column to survey.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('survey_type', sa.Column('fetch_weather', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('survey', sa.Column('weather_snapshot', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('survey', 'weather_snapshot')
    op.drop_column('survey_type', 'fetch_weather')
