"""delete the shared dashboard API key setting

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-21 15:00:00.000000
"""
from alembic import op


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Cookie sessions replace the one shared key (07 Q37, Q38). Nothing reads the row any more, and a stored
    # key is a secret that opened every firm's data, so it is deleted rather than left behind.
    op.execute("DELETE FROM settings WHERE key = 'dashboard_api_key'")


def downgrade() -> None:
    # Nothing to restore: the deleted key is not recoverable, and the older code seeds an empty row itself.
    pass
