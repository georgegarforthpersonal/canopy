"""audio_detection: nullable recording_id + survey_id link

Revision ID: l7d8e9f0a1b2
Revises: k6c7d8e9f0a1
Create Date: 2026-05-03

Lets us persist BirdNET detections that were not turned into snippets.
Detections without an audio file get audio_recording_id=NULL and reach
their survey via the new survey_id column instead of through
audio_recording.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'l7d8e9f0a1b2'
down_revision: Union[str, None] = 'k6c7d8e9f0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('audio_detection', 'audio_recording_id', nullable=True)

    op.add_column('audio_detection', sa.Column('survey_id', sa.Integer(), nullable=True))
    op.execute("""
        UPDATE audio_detection AS ad
        SET survey_id = ar.survey_id
        FROM audio_recording AS ar
        WHERE ad.audio_recording_id = ar.id
          AND ad.survey_id IS NULL
    """)
    op.create_index('ix_audio_detection_survey_id', 'audio_detection', ['survey_id'])
    op.create_foreign_key(
        'fk_audio_detection_survey_id',
        'audio_detection',
        'survey',
        ['survey_id'],
        ['id'],
        ondelete='CASCADE',
    )


def downgrade() -> None:
    op.drop_constraint('fk_audio_detection_survey_id', 'audio_detection', type_='foreignkey')
    op.drop_index('ix_audio_detection_survey_id', table_name='audio_detection')
    op.drop_column('audio_detection', 'survey_id')
    op.execute("DELETE FROM audio_detection WHERE audio_recording_id IS NULL")
    op.alter_column('audio_detection', 'audio_recording_id', nullable=False)
