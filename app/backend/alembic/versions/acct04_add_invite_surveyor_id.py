"""Add invite.surveyor_id for invite-time surveyor linking

Revision ID: acct04
Revises: acct03
Create Date: 2026-07-10

An admin inviting an existing volunteer can point the invite at their
historical surveyor row; accepting the invite then claims that row (sets
its user_id) instead of creating a duplicate surveyor. The admin makes the
match at invite time, so no name-matching is ever needed.

ON DELETE SET NULL: deleting a surveyor degrades any open invite pointing
at it to a plain invite (a fresh surveyor is created on acceptance) rather
than blocking the delete.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'acct04'
down_revision: Union[str, Sequence[str], None] = 'acct03'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('invite', sa.Column(
        'surveyor_id',
        sa.Integer(),
        sa.ForeignKey('surveyor.id', ondelete='SET NULL', name='fk_invite_surveyor_id'),
        nullable=True,
    ))


def downgrade() -> None:
    op.drop_column('invite', 'surveyor_id')
