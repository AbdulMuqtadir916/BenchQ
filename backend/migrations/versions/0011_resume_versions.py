"""Résumé versions and bases through the API: promoted and hidden bases, file fingerprints (resume-versioning.md §3.1,
§3.2; PR 5)

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-02 12:00:00.000000

Additive only:
- `base_resumes.promoted_from_resume_id`: the version a PROMOTED base was copied from (SET NULL if that version is
  deleted). One version gives at most one base, so picking it again switches to that base instead of copying twice.
- `base_resumes.archived_at`: a used base the BDE deleted is hidden, not deleted (§4.7).
- One upload gives at most one base (`uq_base_resumes_one_per_parse`).
- `resume_parses.content_sha256`: the file's fingerprint, filled in here for existing rows. One candidate never keeps
  the same file twice (`uq_resume_parses_candidate_file`); drafts aren't checked.
- `resumes.summary_id`: the summary's id, like every item's (§3.4): one id per exact summary text of a candidate, so
  claims on it follow it from version to version and an edit gives the new text a new id (§4.5). Filled in here for
  versions that have a summary; rows from before versioning get theirs when PR 6 converts them.
"""
from alembic import op
import sqlalchemy as sa


revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('base_resumes', sa.Column('promoted_from_resume_id', sa.UUID(), nullable=True))
    op.add_column('base_resumes', sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key('base_resumes_promoted_from_resume_id_fkey', 'base_resumes', 'resumes',
                          ['promoted_from_resume_id'], ['id'], ondelete='SET NULL')
    op.create_index('uq_base_resumes_one_per_parse', 'base_resumes', ['resume_parse_id'], unique=True,
                    postgresql_where=sa.text('resume_parse_id IS NOT NULL'))
    op.create_index('uq_base_resumes_one_per_version', 'base_resumes', ['promoted_from_resume_id'], unique=True,
                    postgresql_where=sa.text('promoted_from_resume_id IS NOT NULL'))

    op.add_column('resume_parses', sa.Column('content_sha256', sa.String(), nullable=True))
    op.execute("UPDATE resume_parses SET content_sha256 = encode(sha256(content), 'hex')")
    op.alter_column('resume_parses', 'content_sha256', nullable=False)
    # Fails if a candidate already kept the same file twice, on purpose: decide which upload stays first.
    op.create_index('uq_resume_parses_candidate_file', 'resume_parses', ['candidate_id', 'content_sha256'], unique=True,
                    postgresql_where=sa.text('candidate_id IS NOT NULL'))

    op.add_column('resumes', sa.Column('summary_id', sa.String(), nullable=True))
    # One id per candidate per exact summary text: versions that copied it share it, as items share theirs.
    op.execute("""
        WITH ids AS (
            SELECT candidate_id, summary, gen_random_uuid()::text AS id
            FROM (SELECT DISTINCT candidate_id, summary FROM resumes
                  WHERE base_resume_id IS NOT NULL AND btrim(coalesce(summary, '')) <> '') texts)
        UPDATE resumes r SET summary_id = ids.id FROM ids
        WHERE r.base_resume_id IS NOT NULL AND r.candidate_id = ids.candidate_id AND r.summary = ids.summary
    """)


def downgrade() -> None:
    op.drop_column('resumes', 'summary_id')
    op.drop_index('uq_resume_parses_candidate_file', table_name='resume_parses',
                  postgresql_where=sa.text('candidate_id IS NOT NULL'))
    op.drop_column('resume_parses', 'content_sha256')

    # Hidden bases come back to the dropdown, and promoted ones lose the version they came from.
    op.drop_index('uq_base_resumes_one_per_version', table_name='base_resumes',
                  postgresql_where=sa.text('promoted_from_resume_id IS NOT NULL'))
    op.drop_index('uq_base_resumes_one_per_parse', table_name='base_resumes',
                  postgresql_where=sa.text('resume_parse_id IS NOT NULL'))
    op.drop_constraint('base_resumes_promoted_from_resume_id_fkey', 'base_resumes', type_='foreignkey')
    op.drop_column('base_resumes', 'archived_at')
    op.drop_column('base_resumes', 'promoted_from_resume_id')
