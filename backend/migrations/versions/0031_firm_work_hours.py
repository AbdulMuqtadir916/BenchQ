"""Firm work hours and the candidate's Days (decided 2026-11-17, Q152–Q174).

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-17 21:00:00.000000

- `firms.work_start`, `firms.work_end` (time, in the firm's `primary_timezone`): required, no default; every firm that
  exists gets 18:30–04:00 (Q163). Start and end differ.
- `candidates.bde_assigned_at`, `candidates.bde_day_one`: when the current BDE got the candidate and the work date of
  their Day 1. A candidate with a BDE gets their creation time (Q173); without one, both stay null (Q174).
- `scrape_jobs.work_date`: the firm's work day a search or capture started in, from `created_at` (Q170).

A work day runs from one `work_start` to the next (Q161). Day 1 is the assignment's work day when the assignment fell
inside the hours, else the next one (Q164, Q169). Follows 0030.
"""
import sqlalchemy as sa
from alembic import op


revision = '0031'
down_revision = '0030'
branch_labels = None
depends_on = None

# The work date of a moment `t` for a firm `f`: the local date, less a day before the local start time.
_WORK_DATE = ("(CASE WHEN ({t} AT TIME ZONE f.primary_timezone)::time >= f.work_start "
              "THEN ({t} AT TIME ZONE f.primary_timezone)::date "
              "ELSE ({t} AT TIME ZONE f.primary_timezone)::date - 1 END)")
# Inside the hours: start..end, across midnight when the end is earlier.
_IN_HOURS = ("(CASE WHEN f.work_start < f.work_end "
             "THEN ({t} AT TIME ZONE f.primary_timezone)::time >= f.work_start "
             "AND ({t} AT TIME ZONE f.primary_timezone)::time < f.work_end "
             "ELSE ({t} AT TIME ZONE f.primary_timezone)::time >= f.work_start "
             "OR ({t} AT TIME ZONE f.primary_timezone)::time < f.work_end END)")


def upgrade():
    op.add_column('firms', sa.Column('work_start', sa.Time(), nullable=True))
    op.add_column('firms', sa.Column('work_end', sa.Time(), nullable=True))
    op.execute("UPDATE firms SET work_start = '18:30', work_end = '04:00'")
    op.alter_column('firms', 'work_start', nullable=False)
    op.alter_column('firms', 'work_end', nullable=False)
    op.create_check_constraint('ck_firms_work_hours', 'firms', 'work_start <> work_end')

    op.add_column('candidates', sa.Column('bde_assigned_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('candidates', sa.Column('bde_day_one', sa.Date(), nullable=True))
    t = "c.created_at"
    op.execute(f"UPDATE candidates c SET bde_assigned_at = c.created_at, bde_day_one = "
               f"{_WORK_DATE.format(t=t)} + (CASE WHEN {_IN_HOURS.format(t=t)} THEN 0 ELSE 1 END) "
               f"FROM firms f WHERE f.id = c.firm_id AND c.bde_id IS NOT NULL")

    op.add_column('scrape_jobs', sa.Column('work_date', sa.Date(), nullable=True))
    op.execute(f"UPDATE scrape_jobs s SET work_date = {_WORK_DATE.format(t='s.created_at')} "
               f"FROM firms f WHERE f.id = s.firm_id")


def downgrade():
    op.drop_column('scrape_jobs', 'work_date')
    op.drop_column('candidates', 'bde_day_one')
    op.drop_column('candidates', 'bde_assigned_at')
    op.drop_constraint('ck_firms_work_hours', 'firms', type_='check')
    op.drop_column('firms', 'work_end')
    op.drop_column('firms', 'work_start')
