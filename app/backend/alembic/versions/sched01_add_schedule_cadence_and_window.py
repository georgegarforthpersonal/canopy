"""add schedule cadence (survey type) and scheduling window (survey)

Weekly-cadence survey types (e.g. butterflies) are scheduled for a whole week
rather than a specific day:

- ``survey_type.schedule_cadence`` — 'date' (specific day, default) or 'weekly'.
- ``survey.scheduled_window_start`` / ``scheduled_window_end`` — the inclusive
  window a weekly survey may be carried out in; NULL for day-precise schedules.

Revision ID: sched01
Revises: sector01
Create Date: 2026-07-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'sched01'
down_revision: Union[str, Sequence[str], None] = 'sector01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'survey_type',
        sa.Column('schedule_cadence', sa.String(20), nullable=False, server_default='date'),
    )
    op.add_column(
        'survey',
        sa.Column('scheduled_window_start', sa.Date(), nullable=True),
    )
    op.add_column(
        'survey',
        sa.Column('scheduled_window_end', sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('survey', 'scheduled_window_end')
    op.drop_column('survey', 'scheduled_window_start')
    op.drop_column('survey_type', 'schedule_cadence')
