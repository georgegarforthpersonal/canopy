"""Add allow_sighting_photo_upload to survey_type table

Revision ID: h3a4b5c6d7e8
Revises: g2a3b4c5d6e7
Create Date: 2026-04-13

Adds toggle to allow photos to be attached to individual sightings
for documentation purposes (distinct from camera trap image upload).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'h3a4b5c6d7e8'
down_revision: Union[str, None] = 'g2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add allow_sighting_photo_upload column to survey_type table."""
    op.add_column('survey_type', sa.Column('allow_sighting_photo_upload', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    """Remove allow_sighting_photo_upload column from survey_type table."""
    op.drop_column('survey_type', 'allow_sighting_photo_upload')
