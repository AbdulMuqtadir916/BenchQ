"""Job search PR 2: what pointed at the old `jobs` pool points at `job_postings`, and captured jobs (docs/02 §6.y).

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-10 22:00:00.000000

- `scrape_jobs.kind`: `search` (a BDE's search) or `capture` (one job the BDE captured by hand or from the
  extension: its own batch, with one posting). Existing rows are searches.
- `job_postings`: `UNIQUE (firm_id, candidate_id, id)`, the target of the candidate-safe keys below and of
  `applications`' key (Samad's own PR, docs/team/samad.md §2 item 5).
- `resumes (firm_id, candidate_id, job_id)` → `job_postings (firm_id, candidate_id, id)` ON DELETE CASCADE: a
  tailored résumé names its own candidate's job, and deleting the job deletes the résumés tailored for it (Abdul,
  2026-11-01). A base résumé's `job_id` is NULL, so the key doesn't apply to it.
- `cover_letters.job_id`, `job_runs.target_job_id`, `llm_call_log.job_id` → `job_postings.id` ON DELETE SET NULL.

No data is copied (decided 2026-11-10: no real firm uses BenchQ yet). A tailored résumé or a cover letter still naming
an old job stops the upgrade: clear your local test rows first. The downgrade unlinks the other way instead of stopping
(decided 2026-11-11): a cover letter loses its posting, a tailored résumé naming one is deleted, and captures go. The two logs (`job_runs`, `llm_call_log`) are only
unlinked from old jobs, as deleting those jobs would do (their rule is SET NULL). `applications.job_id` stays on `jobs`
until Samad's PR. Follows 0022.
"""
from alembic import op
import sqlalchemy as sa


revision = '0023'
down_revision = '0022'
branch_labels = None
depends_on = None

_LOGS = (('job_runs', 'target_job_id', 'job_runs_target_job_id_fkey'),
         ('llm_call_log', 'job_id', 'llm_call_log_job_id_fkey'))


def _refuse_if(sql: str, what: str):
    count = op.get_bind().execute(sa.text(sql)).scalar()
    if count:
        raise RuntimeError(f"{count} {what}. No real firm uses BenchQ yet, so nothing is copied: clear these local "
                           "test rows, then upgrade again.")


def upgrade():
    _refuse_if("SELECT count(*) FROM resumes WHERE job_id IS NOT NULL",
               "tailored résumé(s) still name a job in the old `jobs` table")
    _refuse_if("SELECT count(*) FROM cover_letters WHERE job_id IS NOT NULL",
               "cover letter(s) still name a job in the old `jobs` table")

    op.add_column('scrape_jobs', sa.Column('kind', sa.String(), server_default=sa.text("'search'"), nullable=False))
    op.create_check_constraint('ck_scrape_jobs_kind', 'scrape_jobs', "kind IN ('search', 'capture')")
    op.create_unique_constraint('uq_job_postings_firm_candidate_id', 'job_postings', ['firm_id', 'candidate_id', 'id'])

    op.drop_constraint('resumes_job_id_fkey', 'resumes', type_='foreignkey')
    op.create_foreign_key('fk_resumes_job_posting', 'resumes', 'job_postings', ['firm_id', 'candidate_id', 'job_id'],
                          ['firm_id', 'candidate_id', 'id'], ondelete='CASCADE')
    op.drop_constraint('cover_letters_job_id_fkey', 'cover_letters', type_='foreignkey')
    op.create_foreign_key('cover_letters_job_id_fkey', 'cover_letters', 'job_postings', ['job_id'], ['id'],
                          ondelete='SET NULL')
    for table, column, name in _LOGS:
        op.execute(f"UPDATE {table} SET {column} = NULL WHERE {column} IS NOT NULL")
        op.drop_constraint(name, table, type_='foreignkey')
        op.create_foreign_key(name, table, 'job_postings', [column], ['id'], ondelete='SET NULL')


def downgrade():
    # 0022 can't point at a posting, and nothing is copied (no real firm uses BenchQ yet; decided 2026-11-11, (a)):
    # a cover letter is only unlinked from its job (its rule is SET NULL); a tailored résumé can't exist without its
    # job (`ck_resumes_category_job`), so it goes, as deleting its job would take it (CASCADE). What points at a
    # résumé lets go of it (applications, letters, base résumés SET NULL) or goes with it (tracer links CASCADE).
    op.execute("UPDATE cover_letters SET job_id = NULL WHERE job_id IS NOT NULL")
    op.execute("DELETE FROM resumes WHERE job_id IS NOT NULL")
    for table, column, name in _LOGS:
        op.execute(f"UPDATE {table} SET {column} = NULL WHERE {column} IS NOT NULL")
        op.drop_constraint(name, table, type_='foreignkey')
        op.create_foreign_key(name, table, 'jobs', [column], ['id'], ondelete='SET NULL')
    op.drop_constraint('cover_letters_job_id_fkey', 'cover_letters', type_='foreignkey')
    op.create_foreign_key('cover_letters_job_id_fkey', 'cover_letters', 'jobs', ['job_id'], ['id'], ondelete='SET NULL')
    op.drop_constraint('fk_resumes_job_posting', 'resumes', type_='foreignkey')
    op.create_foreign_key('resumes_job_id_fkey', 'resumes', 'jobs', ['job_id'], ['id'], ondelete='CASCADE')
    # Captures have no place in 0022: their postings and batches go (nothing else can point at them by now).
    op.execute("DELETE FROM job_postings WHERE batch_id IN (SELECT batch_id FROM scrape_jobs WHERE kind = 'capture')")
    op.execute("DELETE FROM scrape_jobs WHERE kind = 'capture'")
    op.drop_constraint('uq_job_postings_firm_candidate_id', 'job_postings', type_='unique')
    op.drop_constraint('ck_scrape_jobs_kind', 'scrape_jobs', type_='check')
    op.drop_column('scrape_jobs', 'kind')
