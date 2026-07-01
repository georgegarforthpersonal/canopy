"""Add status to survey

Revision ID: survstatus01
Revises: survtypefile01
Create Date: 2026-06-25

Adds an explicit lifecycle status to surveys (scheduled / completed /
cancelled). A survey's "recorded" state can no longer be inferred from whether
it has sightings — a completed survey may legitimately have a nil count of
zero. All existing surveys are historical recorded surveys, so they default to
'completed'.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'survstatus01'
down_revision: Union[str, None] = 'survtypefile01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add survey.status, defaulting existing rows to 'completed'."""
    op.add_column(
        'survey',
        sa.Column('status', sa.String(20), nullable=False, server_default='completed'),
    )


def downgrade() -> None:
    """Drop survey.status."""
    op.drop_column('survey', 'status')
