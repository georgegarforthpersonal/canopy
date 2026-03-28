"""Add device_id foreign key to survey table

Revision ID: l7m8n9o0p1q2
Revises: k6l7m8n9o0p1
Create Date: 2026-03-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'l7m8n9o0p1q2'
down_revision: Union[str, None] = 'k6l7m8n9o0p1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('survey', sa.Column('device_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_survey_device_id', 'survey', 'device', ['device_id'], ['id'])
    op.create_index('ix_survey_device_id', 'survey', ['device_id'])


def downgrade() -> None:
    op.drop_index('ix_survey_device_id', table_name='survey')
    op.drop_constraint('fk_survey_device_id', 'survey', type_='foreignkey')
    op.drop_column('survey', 'device_id')
