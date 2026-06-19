"""location geometry types (area / route / point / none)

Generalise location geometry so a location can be a polygon area, a line route
(transect) or a single point, or have no geometry at all.

- Widen ``location.boundary_geometry`` from geometry(Polygon, 4326) to a generic
  geometry(Geometry, 4326) so lines and points can be stored alongside polygons.
- Add a ``location_type`` discriminator column (area / route / point / none).
- Backfill: existing rows with a boundary become 'area', the rest 'none'.
- Ensure a GIST spatial index exists on the geometry column.

Revision ID: n9f0a1b2c3d4
Revises: m8e9f0a1b2c3
Create Date: 2026-06-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'n9f0a1b2c3d4'
down_revision: Union[str, Sequence[str], None] = 'm8e9f0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Widen the geometry column to accept Polygon / LineString / Point.
    op.execute("""
        ALTER TABLE location
        ALTER COLUMN boundary_geometry TYPE geometry(Geometry, 4326)
        USING boundary_geometry;
    """)

    # 2. Add the location_type discriminator (matches DeviceType: plain string).
    op.add_column(
        'location',
        sa.Column('location_type', sa.String(20), nullable=False, server_default='none'),
    )

    # 3. Backfill: anything with an existing boundary is a polygon area.
    op.execute("""
        UPDATE location
        SET location_type = 'area'
        WHERE boundary_geometry IS NOT NULL;
    """)

    # 4. Ensure a spatial index exists for the geometry column.
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_location_boundary_geometry
        ON location USING GIST(boundary_geometry);
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_location_boundary_geometry;")
    op.drop_column('location', 'location_type')

    # Restore the polygon-only column. Non-polygon geometries (routes/points)
    # cannot fit the stricter type, so they are dropped to NULL.
    op.execute("""
        ALTER TABLE location
        ALTER COLUMN boundary_geometry TYPE geometry(Polygon, 4326)
        USING (
            CASE
                WHEN GeometryType(boundary_geometry) = 'POLYGON' THEN boundary_geometry
                ELSE NULL
            END
        );
    """)
