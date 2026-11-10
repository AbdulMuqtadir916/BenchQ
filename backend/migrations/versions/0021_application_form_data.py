"""The form behind an application: `applications.form_data` (docs/02 §9).

Revision ID: 0021
Revises: 0019
Create Date: 2026-11-07 12:00:00.000000

What the employer's form held when the BDE marked the job applied from the extension. Null on every existing row: an
application already sent has no form to recover, and a Saved one hasn't been sent.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0021'
down_revision = '0019'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('applications', sa.Column('form_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade():
    op.drop_column('applications', 'form_data')
