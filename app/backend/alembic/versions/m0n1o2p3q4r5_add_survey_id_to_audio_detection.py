"""Add survey_id column to audio_detection (merge + idempotent add)

Revision ID: m0n1o2p3q4r5
Revises: a6b7c8d9e0f1, l7d8e9f0a1b2
Create Date: 2026-06-06

The AudioDetection ORM model gained a survey_id FK (revision l7d8e9f0a1b2),
but that revision was on an unreachable branch so alembic upgrade head never
applied it.  This migration:

  1. Merges the orphaned feature branch back into the main chain so that
     alembic upgrade head sees a single head again.
  2. Applies the column addition with IF NOT EXISTS so the upgrade is safe
     regardless of whether l7d8e9f0a1b2 was already applied via
     `alembic upgrade heads` or a manual run.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'm0n1o2p3q4r5'
down_revision: Union[str, Sequence[str], None] = ('a6b7c8d9e0f1', 'l7d8e9f0a1b2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make audio_recording_id nullable so detections can exist without a
    # linked recording.  PostgreSQL's DROP NOT NULL is idempotent.
    op.execute(
        "ALTER TABLE audio_detection "
        "ALTER COLUMN audio_recording_id DROP NOT NULL"
    )
    op.execute(
        "ALTER TABLE audio_detection "
        "ADD COLUMN IF NOT EXISTS survey_id INTEGER "
        "REFERENCES survey(id) ON DELETE CASCADE"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_audio_detection_survey_id "
        "ON audio_detection(survey_id)"
    )
    # Backfill from the linked audio_recording row where possible.
    op.execute("""
        UPDATE audio_detection AS ad
           SET survey_id = ar.survey_id
          FROM audio_recording AS ar
         WHERE ad.audio_recording_id = ar.id
           AND ad.survey_id IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_audio_detection_survey_id")
    op.execute(
        "ALTER TABLE audio_detection DROP COLUMN IF EXISTS survey_id"
    )
    op.execute(
        "ALTER TABLE audio_detection "
        "ALTER COLUMN audio_recording_id SET NOT NULL"
    )
