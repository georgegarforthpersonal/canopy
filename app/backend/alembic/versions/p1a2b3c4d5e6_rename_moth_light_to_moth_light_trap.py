"""Rename device_type 'moth_light' to 'moth_light_trap'

PR #200 added the moth_light_trap device type with the value 'moth_light_trap',
but any devices already in the database with the legacy value 'moth_light' cause
a Pydantic ValidationError when the DeviceRead schema is constructed (Sentry #129144624).

Revision ID: p1a2b3c4d5e6
Revises: o0a1b2c3d4e5
Create Date: 2026-06-20

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'p1a2b3c4d5e6'
down_revision: Union[str, None] = 'o0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE device SET device_type = 'moth_light_trap' WHERE device_type = 'moth_light'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE device SET device_type = 'moth_light' WHERE device_type = 'moth_light_trap'"
    )
