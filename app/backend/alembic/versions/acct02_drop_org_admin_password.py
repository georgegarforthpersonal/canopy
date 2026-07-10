"""drop organisation.admin_password

The shared per-organisation admin password is fully replaced by user
accounts (see acct01): logins are per-user, and roles gate what each
account can do. Nothing reads this column any more, and it held plaintext
passwords, so it is dropped rather than kept around.

Bootstrapping note: with the shared password gone, a fresh organisation's
first admin is created with ``scripts/create_admin.py``.

Revision ID: acct02
Revises: acct01
Create Date: 2026-07-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'acct02'
down_revision: Union[str, Sequence[str], None] = 'acct01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('organisation', 'admin_password')


def downgrade() -> None:
    # The passwords themselves are unrecoverable (by design); restore the
    # column empty so the legacy code path could at least boot.
    op.add_column(
        'organisation',
        sa.Column('admin_password', sa.String(255), nullable=False, server_default=''),
    )
