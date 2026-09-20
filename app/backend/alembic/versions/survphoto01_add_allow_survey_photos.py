"""Add allow_survey_photos to survey_type

Revision ID: survphoto01
Revises: botfreq01
Create Date: 2026-09-19

Habitat and landscape shots describe a visit, not a species, so they belong to
the survey rather than to one of its sightings. The flag gates a per-survey
photo gallery; the photos themselves reuse the existing camera_trap_image rows,
which already hang off survey_id.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'survphoto01'
down_revision: Union[str, None] = 'botfreq01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # IF NOT EXISTS: test databases are built from SQLModel metadata rather than
    # by running migrations, so the column may already be present.
    op.execute(
        'ALTER TABLE survey_type ADD COLUMN IF NOT EXISTS allow_survey_photos BOOLEAN NOT NULL DEFAULT FALSE'
    )


def downgrade() -> None:
    op.execute('ALTER TABLE survey_type DROP COLUMN IF EXISTS allow_survey_photos')
