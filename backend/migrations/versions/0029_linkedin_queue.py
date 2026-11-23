"""LinkedIn's pace, one for the whole backend (decided 2026-11-16, Q76, Q81, Q82; backend/job_search/linkedin_queue.py).

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-16 20:00:00.000000

- `linkedin_slots`: the 4 requests LinkedIn may have from us at a time, one row each (0–3, filled here). A slot is
  free when `busy_until` has passed: taking it sets `busy_until` past the longest request (a crashed holder frees it
  then), and giving it back sets it 5 s ahead (the gap between rounds).
- `linkedin_waiting`: who waits for a slot: an open (someone looking at a job) or a search, and its firm. Opens go
  first, firms take turns, then first come; a row a waiter stopped refreshing (`seen_at`) is dropped.

Postgres holds it so every backend process keeps the same pace (Q82). Additive. Follows 0028.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID


revision = '0029'
down_revision = '0028'
branch_labels = None
depends_on = None

SLOTS = 4


def upgrade():
    op.create_table(
        'linkedin_slots',
        sa.Column('slot', sa.SmallInteger(), primary_key=True),
        sa.Column('busy_until', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('holder', UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(f'slot >= 0 AND slot < {SLOTS}', name='ck_linkedin_slots_slot'),
    )
    op.execute("INSERT INTO linkedin_slots (slot) SELECT generate_series(0, %d)" % (SLOTS - 1))
    op.create_table(
        'linkedin_waiting',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('firm_id', UUID(as_uuid=True), sa.ForeignKey('firms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('seen_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.CheckConstraint("kind IN ('open', 'search')", name='ck_linkedin_waiting_kind'),
    )
    op.create_index('ix_linkedin_waiting_kind_created', 'linkedin_waiting', ['kind', 'created_at'])


def downgrade():
    op.drop_index('ix_linkedin_waiting_kind_created', table_name='linkedin_waiting')
    op.drop_table('linkedin_waiting')
    op.drop_table('linkedin_slots')
