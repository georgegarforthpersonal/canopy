"""Add sighting device selection fields

Revision ID: i4a5b6c7d8e9
Revises: h3a4b5c6d7e8
Create Date: 2026-04-17

Adds the 'attach single device to sighting' feature:
- survey_type.allow_sighting_device_selection — toggle for the feature
- survey_type.sighting_device_type — which device type to pick from
- sighting.device_id — FK to device for per-sighting device selection
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'i4a5b6c7d8e9'
down_revision: Union[str, None] = 'h3a4b5c6d7e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'survey_type',
        sa.Column('allow_sighting_device_selection', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.add_column(
        'survey_type',
        sa.Column('sighting_device_type', sa.String(20), nullable=True),
    )
    op.add_column(
        'sighting',
        sa.Column('device_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_sighting_device_id', 'sighting', 'device', ['device_id'], ['id']
    )
    op.create_index('ix_sighting_device_id', 'sighting', ['device_id'])


def downgrade() -> None:
    op.drop_index('ix_sighting_device_id', table_name='sighting')
    op.drop_constraint('fk_sighting_device_id', 'sighting', type_='foreignkey')
    op.drop_column('sighting', 'device_id')
    op.drop_column('survey_type', 'sighting_device_type')
    op.drop_column('survey_type', 'allow_sighting_device_selection')
