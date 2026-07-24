"""scope the survey_type name unique constraint to the organisation

The legacy global unique key on survey_type.name predates multi-org and
prevented two organisations sharing a type name (e.g. both having "Bird").
The API's duplicate check was already org-scoped; the DB now matches it.

Revision ID: stname01
Revises: stdevice01
Create Date: 2026-07-23

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'stname01'
down_revision: Union[str, Sequence[str], None] = 'stdevice01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # IF EXISTS: the key exists in the real DBs but not in create_all-built
    # test databases.
    op.execute("ALTER TABLE survey_type DROP CONSTRAINT IF EXISTS survey_type_name_key")
    op.create_unique_constraint('uq_survey_type_org_name', 'survey_type', ['organisation_id', 'name'])


def downgrade() -> None:
    op.drop_constraint('uq_survey_type_org_name', 'survey_type', type_='unique')
    op.create_unique_constraint('survey_type_name_key', 'survey_type', ['name'])
