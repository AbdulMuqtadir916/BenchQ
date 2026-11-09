"""Résumé autofill (decided 2026-11-07; the built answers stopped being stored 2026-11-08, Abdul): each résumé version
keeps the autofill entries the user typed for it, and `candidates.qa_bank` goes.

1. `resumes.autofill` (JSONB, `{}` by default): what a person typed for this version,
   `{"edited": {key: {"answer": …, "over": …}}, "custom": {question: answer}}` (an edit to a built answer, by its
   question's key; or a question they added; docs/02 §8.1). The built answers aren't stored as answers:
   `backend/candidates/autofill.py` builds them from the version and the profile each time they're read, and an edit
   keeps a copy of the one it replaced as `over` (for the work history, the whole list). So no row is filled here, and
   this migration imports no app code: every existing version starts with no entries.
2. `candidates.qa_bank` is dropped: only the demo seed ever filled it (the persona's own `qa_bank` stays, with the
   persona). The candidate's Documents tab "Screening answers" panel shows its empty state until the Documents section
   is removed (planned, docs/team/abdul.md §3).

The downgrade drops `autofill` and puts `qa_bank` back empty. Follows 0018.

**A database that ran this migration's first version** (on PR 118's branch before 2026-11-08) has every version's
built answers stored in `autofill`, as `{question: answer}`. The app reads none of that (it reads only `edited` and
`custom`), and a save doesn't copy it on, but the rows keep it. To clear it, downgrade to 0018 and upgrade again
(docs/troubleshooting.md, "Autofill entries left by the first migration 0019").
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
