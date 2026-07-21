"""Add survey_type_species junction table

Revision ID: stspecies01
Revises: coordentry01
Create Date: 2026-07-21

Narrows a survey type to specific species. No rows = all species in the
type's species types (existing behaviour). A single row gives a
fixed-species survey (e.g. Marsh Fritillary, Turtle Dove) where the
surveyor never picks a species.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'stspecies01'
down_revision: Union[str, None] = 'coordentry01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the survey_type_species junction table."""
    op.create_table(
        'survey_type_species',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('survey_type_id', sa.Integer(), nullable=False),
        sa.Column('species_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['survey_type_id'], ['survey_type.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['species_id'], ['species.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    """Drop the survey_type_species junction table."""
    op.drop_table('survey_type_species')
