"""No per-BDE capacity: drop `firms.bde_capacity` (docs/07 Q63, reverses Q46).

Revision ID: 0024
Revises: 0023
Create Date: 2026-11-11 12:00:00.000000

The plan's two limits (BDE seats, assigned candidates) are the only caps. A BDE may hold any number of candidates,
so the firm-wide "comfortable load" and its 1-50 check go. Downgrade puts the column back at the default (10); the
OWNER's earlier values are not kept.
"""
from alembic import op
import sqlalchemy as sa


revision = '0024'
down_revision = '0023'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('ck_firms_bde_capacity_range', 'firms', type_='check')
    op.drop_column('firms', 'bde_capacity')


def downgrade():
    op.add_column('firms', sa.Column('bde_capacity', sa.Integer(), server_default=sa.text('10'), nullable=False))
    op.create_check_constraint('ck_firms_bde_capacity_range', 'firms', 'bde_capacity BETWEEN 1 AND 50')
