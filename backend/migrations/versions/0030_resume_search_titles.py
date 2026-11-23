"""The extra titles a job search asks for besides the target role (decided 2026-11-17, Q131–Q144).

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-17 18:00:00.000000

`resumes.search_titles`: up to 4 job titles, on the candidate's active base's version 1. An AI call makes 2 from the
target role when the candidate is added; the "Additional candidate details" tab shows them and the BDE edits them; a
new active base takes them over. The search asks for the target role's titles and these (5 at most), and the Match
counts them as wanted titles. Null: none made yet (the search asks for the target role alone). Additive. Follows 0029.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = '0030'
down_revision = '0029'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('resumes', sa.Column('search_titles', JSONB(), nullable=True))


def downgrade():
    op.drop_column('resumes', 'search_titles')
