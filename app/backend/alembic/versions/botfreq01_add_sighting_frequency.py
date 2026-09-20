"""Add botanical frequency columns to sighting and the survey_type flag

Revision ID: botfreq01
Revises: recmode01
Create Date: 2026-09-18

Botanical (quadrat) surveys score each species by how often it lands in a
sampling quadrat, not by a head count: a percentage frequency and/or a
relative-frequency band ('+' and '1' through '5', the convention used by the
Cannwood annual monitoring reports). Following the BDS Odonata pattern, the
values live in nullable columns on sighting and the entry UI is gated by an
allow_frequency_score flag on survey_type.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'botfreq01'
down_revision: Union[str, None] = 'recmode01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # IF NOT EXISTS: test databases are built from SQLModel metadata rather than
    # by running migrations, so the columns may already be present.
    op.execute('ALTER TABLE sighting ADD COLUMN IF NOT EXISTS percent_frequency NUMERIC(5, 2)')
    op.execute('ALTER TABLE sighting DROP CONSTRAINT IF EXISTS sighting_percent_frequency_range')
    op.execute(
        'ALTER TABLE sighting ADD CONSTRAINT sighting_percent_frequency_range '
        'CHECK (percent_frequency IS NULL OR (percent_frequency >= 0 AND percent_frequency <= 100))'
    )
    op.execute('ALTER TABLE sighting ADD COLUMN IF NOT EXISTS frequency_band VARCHAR(2)')
    op.execute('ALTER TABLE sighting DROP CONSTRAINT IF EXISTS sighting_frequency_band_scale')
    op.execute(
        "ALTER TABLE sighting ADD CONSTRAINT sighting_frequency_band_scale "
        "CHECK (frequency_band IS NULL OR frequency_band IN ('+', '1', '1+', '2', '3', '4', '5'))"
    )
    op.execute(
        'ALTER TABLE survey_type ADD COLUMN IF NOT EXISTS allow_frequency_score BOOLEAN NOT NULL DEFAULT FALSE'
    )


def downgrade() -> None:
    op.execute('ALTER TABLE sighting DROP CONSTRAINT IF EXISTS sighting_percent_frequency_range')
    op.execute('ALTER TABLE sighting DROP CONSTRAINT IF EXISTS sighting_frequency_band_scale')
    op.execute('ALTER TABLE sighting DROP COLUMN IF EXISTS percent_frequency')
    op.execute('ALTER TABLE sighting DROP COLUMN IF EXISTS frequency_band')
    op.execute('ALTER TABLE survey_type DROP COLUMN IF EXISTS allow_frequency_score')
