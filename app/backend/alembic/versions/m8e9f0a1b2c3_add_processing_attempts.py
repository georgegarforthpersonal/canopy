"""Add processing_attempts to audio_recording and camera_trap_image

Revision ID: m8e9f0a1b2c3
Revises: l7d8e9f0a1b2
Create Date: 2026-06-10

Tracks how many times a job has been attempted so the job dispatcher can
retry transient failures and give up after a configured number of attempts.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'm8e9f0a1b2c3'
down_revision: Union[str, None] = 'l7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'audio_recording',
        sa.Column('processing_attempts', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'camera_trap_image',
        sa.Column('processing_attempts', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_column('camera_trap_image', 'processing_attempts')
    op.drop_column('audio_recording', 'processing_attempts')
