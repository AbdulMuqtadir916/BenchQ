"""The Match score, stored (decided 2026-11-14, Q35, Q39, Q49; backend/match).

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-14 20:00:00.000000

- `job_postings.match_score` (0–100), `match_note` (the first reason it is held at 40) and `match_basis` (a SHA-256 of
  what the score was worked out from: the calculator's version, the scored résumé, the candidate's fields it reads, the
  job's text). A score whose basis no longer matches is worked out again; none is null until then.
- The same three on `resumes`, for a tailored version against its job (the "Resume sent" tag's Match).
- `ix_job_postings_candidate_match`: one candidate's jobs best Match first (the job list, 100 at a time).

Additive: nothing is filled here; the backend scores what has no score when it starts. Follows 0027.
"""
import sqlalchemy as sa
from alembic import op


revision = '0028'
down_revision = '0027'
branch_labels = None
depends_on = None

TABLES = ("job_postings", "resumes")


def upgrade():
    for table in TABLES:
        op.add_column(table, sa.Column('match_score', sa.SmallInteger(), nullable=True))
        op.add_column(table, sa.Column('match_note', sa.String(length=200), nullable=True))
        op.add_column(table, sa.Column('match_basis', sa.String(length=64), nullable=True))
        op.create_check_constraint(f'ck_{table}_match_score_range', table,
                                   'match_score IS NULL OR match_score BETWEEN 0 AND 100')
    op.create_index('ix_job_postings_candidate_match', 'job_postings',
                    ['candidate_id', sa.text('match_score DESC NULLS LAST'), 'id'])


def downgrade():
    op.drop_index('ix_job_postings_candidate_match', table_name='job_postings')
    for table in TABLES:
        op.drop_constraint(f'ck_{table}_match_score_range', table, type_='check')
        op.drop_column(table, 'match_basis')
        op.drop_column(table, 'match_note')
        op.drop_column(table, 'match_score')
