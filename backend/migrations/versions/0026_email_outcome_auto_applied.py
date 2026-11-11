"""Allow the AUTO_APPLIED classification outcome (PR 4 automatic status updates); no data change. Renumbered from 0022 (0024-0025 are
Arbaz's #129).

Revision ID: 0026
Revises: 0023
"""
from alembic import op
import sqlalchemy as sa

revision = '0026'
down_revision = '0023'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('ck_email_outcome', 'email_classifications', type_='check')
    op.create_check_constraint('ck_email_outcome', 'email_classifications',
                               "outcome IN ('REVIEW','OTHER','NO_CHANGE','AUTO_APPLIED')")


def downgrade():
    # An AUTO_APPLIED row is evidence of an automatic status change; the older constraint cannot hold it, and
    # rewriting it would misstate what happened. Decide those rows first (DEBUG D-11).
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT EXISTS (SELECT 1 FROM email_classifications WHERE outcome = 'AUTO_APPLIED')")).scalar():
        raise RuntimeError('Refusing to discard automatic status evidence (AUTO_APPLIED classifications exist).')
    op.drop_constraint('ck_email_outcome', 'email_classifications', type_='check')
    op.create_check_constraint('ck_email_outcome', 'email_classifications', "outcome IN ('REVIEW','OTHER','NO_CHANGE')")
