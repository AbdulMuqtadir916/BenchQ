"""Résumé autofill (decided 2026-11-07): each résumé version holds its own `autofill`, and `candidates.qa_bank` goes.

1. `resumes.autofill` (JSONB, `{}` by default): every non-id fact about the candidate as `{question: answer}`, from the
   version and the candidate's profile (`backend/candidates/autofill.py`).
2. Every existing version, deleted ones too, is filled with the same code the app uses.
3. `candidates.qa_bank` is dropped: only the demo seed ever filled it (the persona's own `qa_bank` stays, with the
   persona). The candidate's Documents tab "Screening answers" panel shows its empty state until the Documents section
   is removed (planned, docs/team/abdul.md §3).

The downgrade drops `autofill` and puts `qa_bank` back empty. Follows 0018.
"""
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0019'
down_revision = '0018'
branch_labels = None
depends_on = None


def upgrade() -> None:
    from backend.candidates.autofill import CANDIDATE_FIELDS, VERSION_FIELDS, build
    op.add_column('resumes', sa.Column('autofill', postgresql.JSONB(astext_type=sa.Text()),
                                       server_default=sa.text("'{}'::jsonb"), nullable=False))
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT r.id, " + ", ".join(f"r.{f}" for f in VERSION_FIELDS) + ", "
        + ", ".join(f"c.{f} AS c_{f}" for f in CANDIDATE_FIELDS)
        + " FROM resumes r JOIN candidates c ON c.id = r.candidate_id")).mappings().all()
    for row in rows:
        version = {f: row[f] for f in VERSION_FIELDS}
        candidate = {f: row[f"c_{f}"] for f in CANDIDATE_FIELDS}
        conn.execute(sa.text("UPDATE resumes SET autofill = CAST(:autofill AS jsonb) WHERE id = :id"),
                     {"autofill": json.dumps(build(candidate, version)), "id": row["id"]})
    op.drop_column('candidates', 'qa_bank')


def downgrade() -> None:
    op.add_column('candidates', sa.Column('qa_bank', postgresql.JSONB(astext_type=sa.Text()),
                                          server_default=sa.text("'[]'::jsonb"), nullable=False))
    op.drop_column('resumes', 'autofill')
