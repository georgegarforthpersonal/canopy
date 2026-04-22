"""Require device.name to be NOT NULL

Revision ID: k6c7d8e9f0a1
Revises: j5b6c7d8e9f0
Create Date: 2026-04-22

Device name is now user-facing (shown instead of the serial device_id in
survey UI), so every device must have one. Backfill any null names with
the serial device_id, then flip the column to NOT NULL.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'k6c7d8e9f0a1'
down_revision: Union[str, None] = 'j5b6c7d8e9f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE device SET name = device_id WHERE name IS NULL")
    op.execute("ALTER TABLE device ALTER COLUMN name SET NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE device ALTER COLUMN name DROP NOT NULL")
