"""Create survey_type_file table

Revision ID: survtypefile01
Revises: o0a1b2c3d4e5
Create Date: 2026-06-25

Adds the survey_type_file table holding reference files (methodology PDFs,
recording forms, ID crib sheets) attached to a survey type. Files themselves
live in Cloudflare R2; this table stores their metadata and R2 key.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'survtypefile01'
down_revision: Union[str, None] = 'o0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create survey_type_file table."""
    op.create_table(
        'survey_type_file',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('survey_type_id', sa.Integer(), nullable=False),
        sa.Column('organisation_id', sa.Integer(), nullable=False),
        sa.Column('filename', sa.String(255), nullable=False),
        sa.Column('content_type', sa.String(100), nullable=True),
        sa.Column('size_bytes', sa.Integer(), nullable=True),
        sa.Column('r2_key', sa.String(500), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['survey_type_id'], ['survey_type.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['organisation_id'], ['organisation.id']),
        sa.UniqueConstraint('r2_key', name='uq_survey_type_file_r2_key'),
    )
    op.create_index('ix_survey_type_file_survey_type_id', 'survey_type_file', ['survey_type_id'])
    op.create_index('ix_survey_type_file_organisation_id', 'survey_type_file', ['organisation_id'])


def downgrade() -> None:
    """Drop survey_type_file table."""
    op.drop_index('ix_survey_type_file_organisation_id', table_name='survey_type_file')
    op.drop_index('ix_survey_type_file_survey_type_id', table_name='survey_type_file')
    op.drop_table('survey_type_file')
