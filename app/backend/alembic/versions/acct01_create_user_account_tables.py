"""create user account tables

Introduces per-user accounts with three roles (viewer, editor, admin):

- ``app_user`` — user accounts, scoped to an organisation, argon2id password
  hashes. Named app_user because "user" is a reserved word in Postgres.
- ``user_session`` — server-side login sessions (token stored hashed) so
  deactivation/role changes revoke access immediately.
- ``invite`` — single-use, expiring invitations that carry the role and
  organisation an account will be created with.
- ``surveyor.user_id`` — optional link from a surveyor to a user account, so
  users can sign themselves up to scheduled surveys.

The legacy ``organisation.admin_password`` column is intentionally kept for
the transition period; it is removed by a later cutover migration once all
organisations have real admin accounts.

Revision ID: acct01
Revises: sched01
Create Date: 2026-07-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'acct01'
down_revision: Union[str, Sequence[str], None] = 'sched01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'app_user',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'organisation_id',
            sa.Integer(),
            sa.ForeignKey('organisation.id'),
            nullable=False,
        ),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('first_name', sa.String(255), nullable=False),
        sa.Column('last_name', sa.String(255), nullable=True),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        sa.Column('last_login_at', sa.DateTime(), nullable=True),
        sa.Column('password_reset_token_hash', sa.String(64), nullable=True),
        sa.Column('password_reset_expires_at', sa.DateTime(), nullable=True),
        sa.UniqueConstraint('organisation_id', 'email', name='uq_app_user_org_email'),
    )
    op.create_index('ix_app_user_organisation_id', 'app_user', ['organisation_id'])

    op.create_table(
        'user_session',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'user_id',
            sa.Integer(),
            sa.ForeignKey('app_user.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_user_session_user_id', 'user_session', ['user_id'])
    op.create_index('ix_user_session_token_hash', 'user_session', ['token_hash'])

    op.create_table(
        'invite',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'organisation_id',
            sa.Integer(),
            sa.ForeignKey('organisation.id'),
            nullable=False,
        ),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column(
            'invited_by_user_id',
            sa.Integer(),
            sa.ForeignKey('app_user.id'),
            nullable=True,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(),
            nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('accepted_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_invite_organisation_id', 'invite', ['organisation_id'])
    op.create_index('ix_invite_token_hash', 'invite', ['token_hash'])

    op.add_column(
        'surveyor',
        sa.Column(
            'user_id',
            sa.Integer(),
            sa.ForeignKey('app_user.id'),
            nullable=True,
        ),
    )
    op.create_unique_constraint('uq_surveyor_user_id', 'surveyor', ['user_id'])


def downgrade() -> None:
    op.drop_constraint('uq_surveyor_user_id', 'surveyor', type_='unique')
    op.drop_column('surveyor', 'user_id')
    op.drop_index('ix_invite_token_hash', table_name='invite')
    op.drop_index('ix_invite_organisation_id', table_name='invite')
    op.drop_table('invite')
    op.drop_index('ix_user_session_token_hash', table_name='user_session')
    op.drop_index('ix_user_session_user_id', table_name='user_session')
    op.drop_table('user_session')
    op.drop_index('ix_app_user_organisation_id', table_name='app_user')
    op.drop_table('app_user')
