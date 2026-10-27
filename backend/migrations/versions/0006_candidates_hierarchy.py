"""Candidates, the firm hierarchy and résumé parses (docs/candidate-onboarding/06-backend.md PR 1; 07 Q40–Q51)

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-27 07:29:22.095946

- `users.manager_id` and `invites.manager_id`: the MANAGER a BDE reports to (Q40). Only a BDE has one. A BDE from
  before the hierarchy keeps none until the OWNER sets it (Q51), so nothing is backfilled and "a BDE has a manager"
  is enforced in code; a later migration adds the full rule once no BDE lacks one.
- `firms.bde_capacity` (Q46), `ledger_entries.note` and the `ASSIGN` action (Q43).
- `candidates` (decision D1, option 1) and `resume_parses` (06 §2, decided 2026-10-27: the file and the parser's
  answer, 60 minutes until a create keeps it).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


# The ledger's actions as of this revision (models/tenancy.py LEDGER_ACTIONS), written out so the migration doesn't
# change if the model's list does.
LEDGER_ACTIONS_BEFORE = (
    "CREATE", "UPDATE", "DELETE", "STATE_CHANGE", "AI_GENERATE", "AI_BLOCK", "AI_OVERRIDE", "EXPORT", "LOGIN",
    "ADMIN_ACCESS", "ADMIN_ACCESS_END", "FIRM_CREATED", "FIRM_SUSPENDED", "FIRM_REACTIVATED", "PLAN_CHANGED",
    "INVITE_SENT", "INVITE_ACCEPTED", "INVITE_REVOKED",
)
LEDGER_ACTIONS = LEDGER_ACTIONS_BEFORE + ("ASSIGN",)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table('candidates',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('manager_id', sa.UUID(), nullable=False),
    sa.Column('bde_id', sa.UUID(), nullable=True),
    sa.Column('created_by_user_id', sa.UUID(), nullable=False),
    sa.Column('full_name', sa.String(), nullable=False),
    sa.Column('email', sa.String(), nullable=True),
    sa.Column('phone', sa.String(), nullable=True),
    sa.Column('linkedin_url', sa.String(), nullable=True),
    sa.Column('city', sa.String(), nullable=True),
    sa.Column('state', sa.String(), nullable=True),
    sa.Column('country', sa.String(), server_default=sa.text("'US'"), nullable=False),
    sa.Column('willing_to_relocate', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('work_auth', sa.String(), nullable=False),
    sa.Column('work_auth_expiry', sa.DateTime(timezone=True), nullable=True),
    sa.Column('needs_sponsorship', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('needs_transfer', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('employment_types', sa.ARRAY(sa.String()), server_default=sa.text("'{}'::character varying[]"), nullable=False),
    sa.Column('rate_min', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('rate_target', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('status', sa.String(), server_default=sa.text("'ON_BENCH'"), nullable=False),
    sa.Column('bench_start_date', sa.DateTime(timezone=True), nullable=True),
    sa.Column('available_from', sa.DateTime(timezone=True), nullable=True),
    sa.Column('notice_period_days', sa.Integer(), nullable=True),
    sa.Column('years_experience', sa.Numeric(precision=4, scale=1), nullable=True),
    sa.Column('primary_role', sa.String(), nullable=True),
    sa.Column('target_roles', sa.ARRAY(sa.String()), server_default=sa.text("'{}'::character varying[]"), nullable=False),
    sa.Column('work_settings', sa.ARRAY(sa.String()), server_default=sa.text("'{}'::character varying[]"), nullable=False),
    sa.Column('preferred_locations', sa.ARRAY(sa.String()), server_default=sa.text("'{}'::character varying[]"), nullable=False),
    sa.Column('contact_notes', sa.Text(), nullable=True),
    sa.Column('persona', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('qa_bank', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('skills', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('summary_state', sa.String(), server_default=sa.text("'UNVERIFIED'"), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("employment_types <@ ARRAY['C2C', 'W2', 'TEEN99', 'FTE']::varchar[]", name='ck_candidates_employment_types'),
    sa.CheckConstraint("status IN ('ON_BENCH', 'INTERVIEWING', 'OFFER', 'PLACED', 'PAUSED', 'INACTIVE')", name='ck_candidates_status'),
    sa.CheckConstraint("summary_state = 'UNVERIFIED'", name='ck_candidates_summary_unverified'),
    sa.CheckConstraint("work_auth IN ('H1B', 'H4_EAD', 'OPT', 'CPT', 'GC', 'GC_EAD', 'USC', 'TN', 'OTHER')", name='ck_candidates_work_auth'),
    sa.CheckConstraint("work_settings <@ ARRAY['ONSITE', 'HYBRID', 'REMOTE']::varchar[]", name='ck_candidates_work_settings'),
    sa.CheckConstraint('char_length(btrim(full_name)) > 0', name='ck_candidates_full_name_not_blank'),
    sa.CheckConstraint('notice_period_days IS NULL OR notice_period_days BETWEEN 0 AND 365', name='ck_candidates_notice_period'),
    sa.CheckConstraint('rate_min IS NULL OR rate_min > 0', name='ck_candidates_rate_min_positive'),
    sa.CheckConstraint('rate_min IS NULL OR rate_target IS NULL OR rate_min <= rate_target', name='ck_candidates_floor_not_above_target'),
    sa.CheckConstraint('rate_target IS NULL OR rate_target > 0', name='ck_candidates_rate_target_positive'),
    sa.CheckConstraint('years_experience IS NULL OR years_experience BETWEEN 0 AND 60', name='ck_candidates_years_experience'),
    sa.ForeignKeyConstraint(['bde_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['manager_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_candidates_firm_bde', 'candidates', ['firm_id', 'bde_id'], unique=False)
    op.create_index(op.f('ix_candidates_firm_id'), 'candidates', ['firm_id'], unique=False)
    op.create_index('ix_candidates_firm_manager', 'candidates', ['firm_id', 'manager_id'], unique=False)
    op.create_table('resume_parses',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('uploaded_by_user_id', sa.UUID(), nullable=False),
    sa.Column('candidate_id', sa.UUID(), nullable=True),
    sa.Column('file_name', sa.String(), nullable=False),
    sa.Column('mime_type', sa.String(), nullable=False),
    sa.Column('size_bytes', sa.Integer(), nullable=False),
    sa.Column('content', sa.LargeBinary(), nullable=False),
    sa.Column('parse', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('(candidate_id IS NULL) = (expires_at IS NOT NULL)', name='ck_resume_parses_kept_or_expiring'),
    sa.CheckConstraint('size_bytes BETWEEN 1 AND 10485760', name='ck_resume_parses_size'),
    sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['uploaded_by_user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_resume_parses_candidate_id'), 'resume_parses', ['candidate_id'], unique=False)
    op.create_index(op.f('ix_resume_parses_firm_id'), 'resume_parses', ['firm_id'], unique=False)
    op.add_column('firms', sa.Column('bde_capacity', sa.Integer(), server_default=sa.text('10'), nullable=False))
    op.create_check_constraint('ck_firms_bde_capacity_range', 'firms', 'bde_capacity BETWEEN 1 AND 50')
    op.add_column('invites', sa.Column('manager_id', sa.UUID(), nullable=True))
    op.create_foreign_key('invites_manager_id_fkey', 'invites', 'users', ['manager_id'], ['id'], ondelete='RESTRICT')
    op.create_check_constraint('ck_invites_only_bde_has_manager', 'invites', "role = 'BDE' OR manager_id IS NULL")
    op.add_column('ledger_entries', sa.Column('note', sa.Text(), nullable=True))
    op.drop_constraint('ck_ledger_entries_action', 'ledger_entries', type_='check')
    op.create_check_constraint('ck_ledger_entries_action', 'ledger_entries', _in('action', LEDGER_ACTIONS))
    op.add_column('users', sa.Column('manager_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_users_manager_id'), 'users', ['manager_id'], unique=False)
    op.create_foreign_key('users_manager_id_fkey', 'users', 'users', ['manager_id'], ['id'], ondelete='RESTRICT')
    op.create_check_constraint('ck_users_only_bde_has_manager', 'users', "role = 'BDE' OR manager_id IS NULL")


def downgrade() -> None:
    op.drop_constraint('ck_users_only_bde_has_manager', 'users', type_='check')
    op.drop_constraint('users_manager_id_fkey', 'users', type_='foreignkey')
    op.drop_index(op.f('ix_users_manager_id'), table_name='users')
    op.drop_column('users', 'manager_id')
    op.execute("DELETE FROM ledger_entries WHERE action = 'ASSIGN'")
    op.drop_constraint('ck_ledger_entries_action', 'ledger_entries', type_='check')
    op.create_check_constraint('ck_ledger_entries_action', 'ledger_entries', _in('action', LEDGER_ACTIONS_BEFORE))
    op.drop_column('ledger_entries', 'note')
    op.drop_constraint('ck_invites_only_bde_has_manager', 'invites', type_='check')
    op.drop_constraint('invites_manager_id_fkey', 'invites', type_='foreignkey')
    op.drop_column('invites', 'manager_id')
    op.drop_constraint('ck_firms_bde_capacity_range', 'firms', type_='check')
    op.drop_column('firms', 'bde_capacity')
    op.drop_index(op.f('ix_resume_parses_firm_id'), table_name='resume_parses')
    op.drop_index(op.f('ix_resume_parses_candidate_id'), table_name='resume_parses')
    op.drop_table('resume_parses')
    op.drop_index('ix_candidates_firm_manager', table_name='candidates')
    op.drop_index(op.f('ix_candidates_firm_id'), table_name='candidates')
    op.drop_index('ix_candidates_firm_bde', table_name='candidates')
    op.drop_table('candidates')
