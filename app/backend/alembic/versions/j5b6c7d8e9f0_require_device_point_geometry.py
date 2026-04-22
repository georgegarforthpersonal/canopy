"""Require device.point_geometry to be NOT NULL

Revision ID: j5b6c7d8e9f0
Revises: i4a5b6c7d8e9
Create Date: 2026-04-22

Every device must be mappable: sightings attached to devices inherit their
coordinates from the device, so a device with a null point_geometry is an
unusable dangling row. All current rows already have a non-null value, so
we can flip the column to NOT NULL directly.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'j5b6c7d8e9f0'
down_revision: Union[str, None] = 'i4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE device ALTER COLUMN point_geometry SET NOT NULL"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE device ALTER COLUMN point_geometry DROP NOT NULL"
    )
