"""Add client_uuid idempotency columns to survey, sighting, sighting_individual

Revision ID: idem01
Revises: acct04
Create Date: 2026-07-12

Field data entry needs retry-safe creates: a request can reach the server
while its response is lost on flaky signal, so the client must be able to
re-send the same create without inserting a duplicate. Clients mint a UUID
per record; the create endpoints return the existing row when the UUID has
already been seen. Partial unique indexes back-stop the check under
concurrent retries. Nullable: requests without a UUID keep today's
plain-insert behaviour.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'idem01'
down_revision: Union[str, Sequence[str], None] = 'acct04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('survey', sa.Column('client_uuid', sa.String(36), nullable=True))
    op.add_column('sighting', sa.Column('client_uuid', sa.String(36), nullable=True))
    op.add_column('sighting_individual', sa.Column('client_uuid', sa.String(36), nullable=True))

    op.create_index(
        'ux_survey_org_client_uuid',
        'survey',
        ['organisation_id', 'client_uuid'],
        unique=True,
        postgresql_where=sa.text('client_uuid IS NOT NULL'),
    )
    op.create_index(
        'ux_sighting_survey_client_uuid',
        'sighting',
        ['survey_id', 'client_uuid'],
        unique=True,
        postgresql_where=sa.text('client_uuid IS NOT NULL'),
    )
    op.create_index(
        'ux_sighting_individual_client_uuid',
        'sighting_individual',
        ['sighting_id', 'client_uuid'],
        unique=True,
        postgresql_where=sa.text('client_uuid IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index('ux_sighting_individual_client_uuid', table_name='sighting_individual')
    op.drop_index('ux_sighting_survey_client_uuid', table_name='sighting')
    op.drop_index('ux_survey_org_client_uuid', table_name='survey')
    op.drop_column('sighting_individual', 'client_uuid')
    op.drop_column('sighting', 'client_uuid')
    op.drop_column('survey', 'client_uuid')
