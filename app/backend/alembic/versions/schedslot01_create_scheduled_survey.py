"""create scheduled_survey slots and link surveys to them

Scheduling moves out of the survey table into a dedicated ``scheduled_survey``
table (a plan/slot). Recorded surveys point at their slot via a nullable
``survey.scheduled_survey_id`` FK (SET NULL on slot delete); fulfilment is
derived (>=1 linked survey), never stored. Day-precise cadence stores
``window_start == window_end``.

Data migration:
- scheduled/cancelled survey rows without sightings become slots and are
  deleted (their surveyor links become slot pre-assignments).
- scheduled rows WITH sightings (in-progress recordings) get a slot
  synthesized and linked, and survive as recorded surveys.
- completed rows carrying a scheduling window get deduplicated fulfilled
  slots synthesized and linked (the survey keeps its own surveyors).

Then ``survey.status`` and the window columns are dropped: a survey row is
always a real recorded event.

Revision ID: schedslot01
Revises: stspecies01
Create Date: 2026-07-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'schedslot01'
down_revision: Union[str, Sequence[str], None] = 'stspecies01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'scheduled_survey',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('organisation_id', sa.Integer(), sa.ForeignKey('organisation.id'), nullable=False),
        sa.Column('survey_type_id', sa.Integer(), sa.ForeignKey('survey_type.id'), nullable=False),
        sa.Column('location_id', sa.Integer(), sa.ForeignKey('location.id'), nullable=True),
        sa.Column('window_start', sa.Date(), nullable=False),
        sa.Column('window_end', sa.Date(), nullable=False),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='open'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        # Temporary mapping column for the data migration, dropped below.
        sa.Column('migrated_from_survey_id', sa.Integer(), nullable=True),
    )
    op.create_index('ix_scheduled_survey_organisation_id', 'scheduled_survey', ['organisation_id'])
    op.create_index('ix_scheduled_survey_survey_type_id', 'scheduled_survey', ['survey_type_id'])

    op.create_table(
        'scheduled_survey_surveyor',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('scheduled_survey_id', sa.Integer(),
                  sa.ForeignKey('scheduled_survey.id', ondelete='CASCADE'), nullable=False),
        sa.Column('surveyor_id', sa.Integer(),
                  sa.ForeignKey('surveyor.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
    )

    op.add_column(
        'survey',
        sa.Column('scheduled_survey_id', sa.Integer(),
                  sa.ForeignKey('scheduled_survey.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index('ix_survey_scheduled_survey_id', 'survey', ['scheduled_survey_id'])

    # --- Data migration -----------------------------------------------------

    # 1. Scheduled/cancelled placeholder rows (no sightings) become slots.
    #    Day-precise rows have no window: their date is the single-day window.
    op.execute("""
        INSERT INTO scheduled_survey (organisation_id, survey_type_id, location_id,
                                      window_start, window_end, notes, status, created_at,
                                      migrated_from_survey_id)
        SELECT s.organisation_id, s.survey_type_id, s.location_id,
               COALESCE(s.scheduled_window_start, s.date),
               COALESCE(s.scheduled_window_end, s.date),
               s.notes,
               CASE s.status WHEN 'cancelled' THEN 'cancelled' ELSE 'open' END,
               s.created_at, s.id
        FROM survey s
        WHERE s.status IN ('scheduled', 'cancelled')
          AND s.survey_type_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM sighting WHERE sighting.survey_id = s.id)
    """)
    op.execute("""
        INSERT INTO scheduled_survey_surveyor (scheduled_survey_id, surveyor_id, created_at)
        SELECT ss.id, sv.surveyor_id, sv.created_at
        FROM scheduled_survey ss
        JOIN survey_surveyor sv ON sv.survey_id = ss.migrated_from_survey_id
    """)
    op.execute("""
        DELETE FROM survey_surveyor
        WHERE survey_id IN (SELECT migrated_from_survey_id FROM scheduled_survey
                            WHERE migrated_from_survey_id IS NOT NULL)
    """)
    op.execute("""
        DELETE FROM survey
        WHERE id IN (SELECT migrated_from_survey_id FROM scheduled_survey
                     WHERE migrated_from_survey_id IS NOT NULL)
    """)

    # 2. Scheduled rows WITH sightings are in-progress recordings: synthesize a
    #    slot, keep the survey row (it becomes a recorded survey when the
    #    status column is dropped) and link it.
    op.execute("""
        INSERT INTO scheduled_survey (organisation_id, survey_type_id, location_id,
                                      window_start, window_end, notes, status, created_at,
                                      migrated_from_survey_id)
        SELECT s.organisation_id, s.survey_type_id, s.location_id,
               COALESCE(s.scheduled_window_start, s.date),
               COALESCE(s.scheduled_window_end, s.date),
               s.notes, 'open', s.created_at, s.id
        FROM survey s
        WHERE s.status = 'scheduled'
          AND s.survey_type_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM sighting WHERE sighting.survey_id = s.id)
    """)
    op.execute("""
        UPDATE survey s SET scheduled_survey_id = ss.id
        FROM scheduled_survey ss
        WHERE ss.migrated_from_survey_id = s.id
          AND s.status = 'scheduled'
    """)

    # 3. Completed rows carrying a window were the old destructive "adoption":
    #    synthesize the (deduplicated) slot back and link the survey to it.
    op.execute("""
        INSERT INTO scheduled_survey (organisation_id, survey_type_id, location_id,
                                      window_start, window_end, status, created_at)
        SELECT DISTINCT s.organisation_id, s.survey_type_id, s.location_id,
               s.scheduled_window_start, s.scheduled_window_end, 'open', CURRENT_TIMESTAMP
        FROM survey s
        WHERE s.status = 'completed'
          AND s.scheduled_window_start IS NOT NULL
          AND s.scheduled_window_end IS NOT NULL
          AND s.survey_type_id IS NOT NULL
    """)
    op.execute("""
        UPDATE survey s SET scheduled_survey_id = ss.id
        FROM scheduled_survey ss
        WHERE s.status = 'completed'
          AND s.scheduled_window_start IS NOT NULL
          AND ss.migrated_from_survey_id IS NULL
          AND ss.organisation_id = s.organisation_id
          AND ss.survey_type_id = s.survey_type_id
          AND ss.window_start = s.scheduled_window_start
          AND ss.window_end = s.scheduled_window_end
          AND (ss.location_id = s.location_id
               OR (ss.location_id IS NULL AND s.location_id IS NULL))
    """)

    # 4. Degenerate scheduled/cancelled rows with no survey type cannot become
    #    slots; sighting-free ones are dropped (they were invisible plans),
    #    any carrying sightings survive as recorded surveys. Surveyor links go
    #    first — the pre-baseline survey_surveyor FK may lack ON DELETE CASCADE.
    op.execute("""
        DELETE FROM survey_surveyor sv
        USING survey s
        WHERE sv.survey_id = s.id
          AND s.status IN ('scheduled', 'cancelled')
          AND s.survey_type_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM sighting WHERE sighting.survey_id = s.id)
    """)
    op.execute("""
        DELETE FROM survey s
        WHERE s.status IN ('scheduled', 'cancelled')
          AND s.survey_type_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM sighting WHERE sighting.survey_id = s.id)
    """)

    # --- Drop the old scheduling columns ------------------------------------
    op.drop_column('scheduled_survey', 'migrated_from_survey_id')
    op.drop_column('survey', 'scheduled_window_end')
    op.drop_column('survey', 'scheduled_window_start')
    op.drop_column('survey', 'status')


def downgrade() -> None:
    """Best-effort and lossy: slots become scheduled survey rows again, linked
    weekly surveys get their window back, but adoption's destructive delete
    semantics (and any multi-survey links) cannot be faithfully restored."""
    op.add_column('survey', sa.Column('status', sa.String(20), nullable=False, server_default='completed'))
    op.add_column('survey', sa.Column('scheduled_window_start', sa.Date(), nullable=True))
    op.add_column('survey', sa.Column('scheduled_window_end', sa.Date(), nullable=True))

    # Linked surveys re-absorb their slot's window (weekly slots only).
    op.execute("""
        UPDATE survey s
        SET scheduled_window_start = ss.window_start,
            scheduled_window_end = ss.window_end
        FROM scheduled_survey ss
        WHERE s.scheduled_survey_id = ss.id
          AND ss.window_start <> ss.window_end
    """)

    # Unfulfilled slots become scheduled/cancelled survey rows again.
    op.execute("""
        INSERT INTO survey (organisation_id, survey_type_id, location_id, date,
                            notes, status, scheduled_window_start, scheduled_window_end, created_at)
        SELECT ss.organisation_id, ss.survey_type_id, ss.location_id, ss.window_start,
               ss.notes,
               CASE ss.status WHEN 'cancelled' THEN 'cancelled' ELSE 'scheduled' END,
               CASE WHEN ss.window_start <> ss.window_end THEN ss.window_start END,
               CASE WHEN ss.window_start <> ss.window_end THEN ss.window_end END,
               ss.created_at
        FROM scheduled_survey ss
        WHERE NOT EXISTS (SELECT 1 FROM survey WHERE survey.scheduled_survey_id = ss.id)
    """)
    op.execute("""
        INSERT INTO survey_surveyor (survey_id, surveyor_id, created_at)
        SELECT s.id, ssv.surveyor_id, ssv.created_at
        FROM survey s
        JOIN scheduled_survey ss
          ON ss.organisation_id = s.organisation_id
         AND ss.survey_type_id = s.survey_type_id
         AND ss.window_start = s.date
         AND s.status IN ('scheduled', 'cancelled')
        JOIN scheduled_survey_surveyor ssv ON ssv.scheduled_survey_id = ss.id
        WHERE NOT EXISTS (SELECT 1 FROM survey linked WHERE linked.scheduled_survey_id = ss.id)
    """)

    op.drop_index('ix_survey_scheduled_survey_id', table_name='survey')
    op.drop_column('survey', 'scheduled_survey_id')
    op.drop_table('scheduled_survey_surveyor')
    op.drop_index('ix_scheduled_survey_survey_type_id', table_name='scheduled_survey')
    op.drop_index('ix_scheduled_survey_organisation_id', table_name='scheduled_survey')
    op.drop_table('scheduled_survey')
