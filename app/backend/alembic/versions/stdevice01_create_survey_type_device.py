"""create survey_type_device junction table

Devices can now be allocated to a survey type in its config (like
locations), so the group page's Locations panel can show a camera trap
type's cameras or an audio type's recorders.

Revision ID: stdevice01
Revises: schedslot01
Create Date: 2026-07-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'stdevice01'
down_revision: Union[str, Sequence[str], None] = 'schedslot01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'survey_type_device',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('survey_type_id', sa.Integer(),
                  sa.ForeignKey('survey_type.id', ondelete='CASCADE'), nullable=False),
        sa.Column('device_id', sa.Integer(),
                  sa.ForeignKey('device.id', ondelete='CASCADE'), nullable=False),
    )
    op.create_index('ix_survey_type_device_survey_type_id', 'survey_type_device', ['survey_type_id'])


def downgrade() -> None:
    op.drop_index('ix_survey_type_device_survey_type_id', table_name='survey_type_device')
    op.drop_table('survey_type_device')
