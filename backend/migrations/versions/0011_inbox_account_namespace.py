"""Preserve the source account of retained candidate email.

Revision ID: 0011
Revises: 0010
"""
from alembic import op
import sqlalchemy as sa

revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('inbox_messages', sa.Column('source_address', sa.String(), nullable=False, server_default=''))
    op.execute("UPDATE inbox_messages AS m SET source_address = lower(trim(b.address)) "
               "FROM candidate_mailboxes AS b WHERE b.id = m.mailbox_id")
    op.drop_constraint('uq_inbox_messages_mailbox_message', 'inbox_messages', type_='unique')
    op.create_unique_constraint('uq_inbox_messages_mailbox_message', 'inbox_messages',
                                ['mailbox_id', 'source_address', 'provider_message_id'])


def downgrade():
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM inbox_messages m "
            "JOIN candidate_mailboxes b ON b.id=m.mailbox_id "
            "WHERE m.source_address NOT IN ('', lower(trim(b.address)))) "
            "OR EXISTS (SELECT 1 FROM inbox_messages GROUP BY mailbox_id, provider_message_id HAVING count(*) > 1)")).scalar():
        raise RuntimeError('Keep revision 0011 to preserve retained mailbox account provenance.')
    op.drop_constraint('uq_inbox_messages_mailbox_message', 'inbox_messages', type_='unique')
    op.create_unique_constraint('uq_inbox_messages_mailbox_message', 'inbox_messages',
                                ['mailbox_id', 'provider_message_id'])
    op.drop_column('inbox_messages', 'source_address')
