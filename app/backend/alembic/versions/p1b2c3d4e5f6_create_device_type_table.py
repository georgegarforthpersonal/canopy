"""create device_type registry table

Introduce an admin-configurable device type registry so organisations can create
their own (passive) device types in addition to the three built-in types.

- Create the ``device_type`` table holding global *system* types
  (organisation_id NULL, is_system True) and per-organisation *custom* types.
- Enforce uniqueness: (organisation_id, slug) for org rows, and a partial unique
  index on slug for system rows (organisation_id IS NULL).
- Seed the three built-in system types (audio_recorder / camera_trap / refugia)
  with the colours/icons previously hardcoded in the frontend.
- Widen ``device.device_type`` and ``survey_type.sighting_device_type`` from
  VARCHAR(20) to VARCHAR(50) so longer custom slugs fit.

Revision ID: p1b2c3d4e5f6
Revises: o0a1b2c3d4e5
Create Date: 2026-06-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'p1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'o0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Built-in system types — kept in sync with SYSTEM_DEVICE_TYPES in models.py.
SYSTEM_DEVICE_TYPES = [
    {"slug": "audio_recorder", "display_name": "Audio Recorder", "icon_key": "microphone", "color": "#D9730D"},
    {"slug": "camera_trap", "display_name": "Camera Trap", "icon_key": "camera", "color": "#2B5F86"},
    {"slug": "refugia", "display_name": "Refugia", "icon_key": "house", "color": "#4D6461"},
]


def upgrade() -> None:
    device_type = op.create_table(
        'device_type',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('organisation_id', sa.Integer(), nullable=True),
        sa.Column('slug', sa.String(50), nullable=False),
        sa.Column('display_name', sa.String(100), nullable=False),
        sa.Column('icon_key', sa.String(50), nullable=False),
        sa.Column('color', sa.String(7), nullable=False),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['organisation_id'], ['organisation.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organisation_id', 'slug', name='uq_device_type_org_slug'),
    )
    op.create_index('ix_device_type_organisation_id', 'device_type', ['organisation_id'])
    # System slugs (organisation_id IS NULL) are globally unique.
    op.create_index(
        'uq_device_type_system_slug', 'device_type', ['slug'],
        unique=True,
        postgresql_where=sa.text('organisation_id IS NULL'),
    )

    # Seed the built-in system types.
    op.bulk_insert(
        device_type,
        [
            {
                "organisation_id": None,
                "slug": t["slug"],
                "display_name": t["display_name"],
                "icon_key": t["icon_key"],
                "color": t["color"],
                "is_system": True,
                "is_active": True,
            }
            for t in SYSTEM_DEVICE_TYPES
        ],
    )

    # Widen the slug-bearing columns so longer custom slugs fit.
    op.alter_column('device', 'device_type', type_=sa.String(50), existing_type=sa.String(20))
    op.alter_column('survey_type', 'sighting_device_type', type_=sa.String(50), existing_type=sa.String(20))


def downgrade() -> None:
    op.alter_column('survey_type', 'sighting_device_type', type_=sa.String(20), existing_type=sa.String(50))
    op.alter_column('device', 'device_type', type_=sa.String(20), existing_type=sa.String(50))
    op.drop_index('uq_device_type_system_slug', table_name='device_type')
    op.drop_index('ix_device_type_organisation_id', table_name='device_type')
    op.drop_table('device_type')
