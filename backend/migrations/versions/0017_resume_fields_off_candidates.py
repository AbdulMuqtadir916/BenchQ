"""The résumé's fields leave `candidates`: name, email, phone, LinkedIn, city, state and country live in the résumé.

Decided by Zuhair (2026-11-03, again 2026-11-06; 07 Q57): what the parser's strict format holds lives in `resumes`, not
in `candidates`. The profile reads these from the candidate's active base, newest version (`backend/candidates/
profile.py`); the API still returns them under the same names. What the owner and manager decide stays on `candidates`
(`primary_role`, `years_experience`, `work_auth`, rates, availability, preferences…).

Before the drop, nothing is lost:
1. A candidate with no live base (the demo seed's, or any made before 0015's MANUAL rule) gets one: a MANUAL base, active,
   whose v1 holds those fields, `primary_role` as its title. The same as a candidate created without a file today.
2. Every base version's empty header field is filled from `candidates` (a résumé's own value is kept).

The downgrade puts the columns back, filled from the active base's newest version (`full_name` falls back to the
candidate's id when a base has none, since it is NOT NULL). Bases the upgrade made stay (they are ordinary MANUAL bases).

Follows 0016. Owner of `candidates`: Abdul (his review of this change is the approval, cross-area-changes.md).
"""

from alembic import op
import sqlalchemy as sa

revision = '0017'
down_revision = '0016'
branch_labels = None
depends_on = None

_FIELDS = ("full_name", "email", "phone", "linkedin_url", "city", "state", "country")
# candidates column → resumes column
_TO_RESUME = {"full_name": "full_name", "email": "email", "phone": "phone", "linkedin_url": "linkedin",
              "city": "city", "state": "state", "country": "country"}


def upgrade() -> None:
    conn = op.get_bind()
    # 1. A MANUAL base (active) and its v1 for every candidate with no live base.
    conn.execute(sa.text("""
        CREATE TEMP TABLE _new_bases ON COMMIT DROP AS
        SELECT gen_random_uuid() AS base_id, c.id AS candidate_id, c.firm_id, c.created_by_user_id
        FROM candidates c
        WHERE NOT EXISTS (SELECT 1 FROM base_resumes b WHERE b.candidate_id = c.id AND b.deleted_at IS NULL)
    """))
    conn.execute(sa.text("""
        UPDATE base_resumes SET is_active = false
        WHERE candidate_id IN (SELECT candidate_id FROM _new_bases) AND is_active
    """))
    conn.execute(sa.text("""
        INSERT INTO base_resumes (id, firm_id, candidate_id, source, is_active, created_by_user_id, created_at)
        SELECT n.base_id, n.firm_id, n.candidate_id, 'MANUAL', true, n.created_by_user_id, now() FROM _new_bases n
    """))
    conn.execute(sa.text("""
        INSERT INTO resumes (id, firm_id, name, candidate_id, base_resume_id, category, version, created_by_user_id,
                             created_at, full_name, title, email, phone, linkedin, city, state, country)
        SELECT gen_random_uuid(), c.firm_id, 'Base', c.id, n.base_id, 'BASE', 1, n.created_by_user_id, now(),
               c.full_name, c.primary_role, c.email, c.phone, c.linkedin_url, c.city, c.state, c.country
        FROM _new_bases n JOIN candidates c ON c.id = n.candidate_id
    """))
    # 2. Empty header fields of every base version, from the candidate (the résumé's own value wins).
    sets = ", ".join(f"{dst} = COALESCE(NULLIF(r.{dst}, ''), c.{src})" for src, dst in _TO_RESUME.items())
    conn.execute(sa.text(f"""
        UPDATE resumes r SET {sets}
        FROM candidates c WHERE c.id = r.candidate_id AND r.category = 'BASE'
    """))
    for column in _FIELDS:
        op.drop_column('candidates', column)


def downgrade() -> None:
    op.add_column('candidates', sa.Column('full_name', sa.String(), nullable=True))
    for column in ("email", "phone", "linkedin_url", "city", "state"):
        op.add_column('candidates', sa.Column(column, sa.String(), nullable=True))
    op.add_column('candidates', sa.Column('country', sa.String(), nullable=False, server_default=sa.text("'US'")))
    conn = op.get_bind()
    sets = ", ".join(f"{src} = v.{dst}" for src, dst in _TO_RESUME.items() if src != "country")
    conn.execute(sa.text(f"""
        UPDATE candidates c SET {sets}, country = COALESCE(NULLIF(v.country, ''), 'US')
        FROM (SELECT DISTINCT ON (r.candidate_id) r.*
              FROM resumes r JOIN base_resumes b ON b.id = r.base_resume_id
              WHERE b.is_active AND b.deleted_at IS NULL AND r.category = 'BASE' AND r.deleted_at IS NULL
              ORDER BY r.candidate_id, r.version DESC) v
        WHERE v.candidate_id = c.id
    """))
    conn.execute(sa.text("UPDATE candidates SET full_name = id::text WHERE full_name IS NULL OR full_name = ''"))
    op.alter_column('candidates', 'full_name', nullable=False)
