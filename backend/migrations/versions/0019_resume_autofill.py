"""Résumé autofill (decided 2026-11-07; the built answers stopped being stored 2026-11-08, Abdul): each résumé version
keeps the autofill entries the user typed for it, and `candidates.qa_bank` goes.

1. `resumes.autofill` (JSONB, `{}` by default): only what a person typed for this version, `{question: answer}` (an edit
   to a built answer, or a question they added). The built answers aren't stored: `backend/candidates/autofill.py`
   builds them from the version and the profile each time they're read. So no row is filled here, and this migration
   imports no app code: every existing version starts with no entries.
2. `candidates.qa_bank` is dropped: only the demo seed ever filled it (the persona's own `qa_bank` stays, with the
   persona). The candidate's Documents tab "Screening answers" panel shows its empty state until the Documents section
   is removed (planned, docs/team/abdul.md §3).

The downgrade drops `autofill` and puts `qa_bank` back empty. Follows 0018.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0019'
down_revision = '0018'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('resumes', sa.Column('autofill', postgresql.JSONB(astext_type=sa.Text()),
                                       server_default=sa.text("'{}'::jsonb"), nullable=False))
    op.drop_column('candidates', 'qa_bank')


def downgrade() -> None:
    op.add_column('candidates', sa.Column('qa_bank', postgresql.JSONB(astext_type=sa.Text()),
                                          server_default=sa.text("'[]'::jsonb"), nullable=False))
    op.drop_column('resumes', 'autofill')
