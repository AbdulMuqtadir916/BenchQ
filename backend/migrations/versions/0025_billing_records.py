"""Billing records: a price per BDE and 30-day billing periods (docs/07 Q64-Q66, docs/02 §3.5).

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-12 12:00:00.000000

`plans.price_cents_per_seat` and `firms.price_cents_per_seat` (USD cents, default $35, the firm's copied from its plan
below). `firm_billing_periods` is one row per firm per 30 days: a snapshot of the BDE count, limits and price, with the
amount (count x price) checked by the database. Super Admin only; no firm-side response carries any of it. Existing
firms get no period ("No billing period"). Candidate limits of existing firms are left as they are; the Super Admin's
next BDE-count edit sets them to 10 x the count.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0025'
down_revision = '0024'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('plans', sa.Column('price_cents_per_seat', sa.Integer(), server_default=sa.text('3500'), nullable=False))
    op.create_check_constraint('ck_plans_price_not_negative', 'plans', 'price_cents_per_seat >= 0')
    op.add_column('firms', sa.Column('price_cents_per_seat', sa.Integer(), server_default=sa.text('3500'), nullable=False))
    op.create_check_constraint('ck_firms_price_not_negative', 'firms', 'price_cents_per_seat >= 0')
    op.execute('UPDATE firms SET price_cents_per_seat = plans.price_cents_per_seat FROM plans WHERE plans.id = firms.plan_id')

    op.create_table(
        'firm_billing_periods',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('firm_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('starts_on', sa.Date(), nullable=False),
        sa.Column('ends_on', sa.Date(), nullable=False),
        sa.Column('seat_limit', sa.Integer(), nullable=False),
        sa.Column('candidate_limit', sa.Integer(), nullable=False),
        sa.Column('jobs_per_candidate_per_day', sa.Integer(), nullable=False),
        sa.Column('price_cents_per_seat', sa.Integer(), nullable=False),
        sa.Column('amount_cents', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(), server_default=sa.text("'UNPAID'"), nullable=False),
        sa.Column('paid_on', sa.Date(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('firm_id', 'starts_on', name='uq_firm_billing_periods_firm_start'),
        sa.CheckConstraint("status IN ('UNPAID', 'PAID')", name='ck_firm_billing_periods_status'),
        sa.CheckConstraint('ends_on = starts_on + 30', name='ck_firm_billing_periods_30_days'),
        sa.CheckConstraint('seat_limit >= 0 AND candidate_limit >= 0 AND price_cents_per_seat >= 0',
                           name='ck_firm_billing_periods_not_negative'),
        sa.CheckConstraint('amount_cents = seat_limit * price_cents_per_seat', name='ck_firm_billing_periods_amount'),
        sa.CheckConstraint("(status = 'PAID') = (paid_on IS NOT NULL)", name='ck_firm_billing_periods_paid_on'),
    )
    op.create_index('ix_firm_billing_periods_firm_id', 'firm_billing_periods', ['firm_id'])


def downgrade():
    op.drop_index('ix_firm_billing_periods_firm_id', table_name='firm_billing_periods')
    op.drop_table('firm_billing_periods')
    op.drop_constraint('ck_firms_price_not_negative', 'firms', type_='check')
    op.drop_column('firms', 'price_cents_per_seat')
    op.drop_constraint('ck_plans_price_not_negative', 'plans', type_='check')
    op.drop_column('plans', 'price_cents_per_seat')
