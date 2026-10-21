"""widen tracer_links.token to VARCHAR(16)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-21 11:30:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # routes_resumes mints secrets.token_urlsafe(8), which is 11 characters, so the baseline's VARCHAR(10)
    # refused every random tracer token on Postgres (found when the tests moved to Postgres, F1).
    # Widening a VARCHAR is a catalog-only change in Postgres: no table rewrite, the indexes stay.
    op.alter_column('tracer_links', 'token', existing_type=sa.String(length=10), type_=sa.String(length=16),
                    existing_nullable=False)


def downgrade() -> None:
    # Fails while any token is longer than 10 characters, which is the point: shrinking would cut them.
    op.alter_column('tracer_links', 'token', existing_type=sa.String(length=16), type_=sa.String(length=10),
                    existing_nullable=False)
