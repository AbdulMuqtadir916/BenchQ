"""auth and tenancy tables (F2a, 07 Q37, Q38)

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-21 09:51:53.852473

Firms, plans, firm users, platform users, invites, sessions, support views and the business ledger, shaped
by the approved contracts (docs/02 §3.1). Nothing reads them until the sign-in PR. Also creates:
  - a trigger that keeps one email per account across `users` and `platform_users` (a unique index can't
    span two tables);
  - the "Default" plan and "Default firm", which F2b fills into `firm_id` on today's rows.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('plans',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('seat_limit', sa.Integer(), nullable=False),
    sa.Column('candidate_limit', sa.Integer(), nullable=False),
    sa.Column('features', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('seat_limit >= 0 AND candidate_limit >= 0', name='ck_plans_limits_not_negative'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name'),
    )
    op.create_table('platform_users',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('email', sa.String(), nullable=False),
    sa.Column('password_hash', sa.String(), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('last_active_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('email = lower(email)', name='ck_platform_users_email_lowercase'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email'),
    )
    op.create_table('firms',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('slug', sa.String(), nullable=False),
    sa.Column('status', sa.String(), server_default=sa.text("'ONBOARDING'"), nullable=False),
    sa.Column('plan_id', sa.UUID(), nullable=False),
    sa.Column('seat_limit', sa.Integer(), nullable=False),
    sa.Column('candidate_limit', sa.Integer(), nullable=False),
    sa.Column('contact_phone', sa.String(), nullable=True),
    sa.Column('logo_url', sa.String(), nullable=True),
    sa.Column('primary_timezone', sa.String(), server_default=sa.text("'Asia/Kolkata'"), nullable=False),
    sa.Column('client_timezone', sa.String(), server_default=sa.text("'America/New_York'"), nullable=False),
    sa.Column('truth_guard_mode', sa.String(), server_default=sa.text("'BALANCED'"), nullable=False),
    sa.Column('application_expiry_days', sa.Integer(), server_default=sa.text('30'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("slug ~ '^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$'", name='ck_firms_slug_format'),
    sa.CheckConstraint("status IN ('ONBOARDING', 'ACTIVE', 'SUSPENDED')", name='ck_firms_status'),
    sa.CheckConstraint("truth_guard_mode IN ('STRICT', 'BALANCED', 'LENIENT')", name='ck_firms_truth_guard_mode'),
    sa.CheckConstraint('application_expiry_days > 0', name='ck_firms_application_expiry_days_positive'),
    sa.CheckConstraint('seat_limit >= 0 AND candidate_limit >= 0', name='ck_firms_limits_not_negative'),
    sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('slug'),
    )
    op.create_index(op.f('ix_firms_plan_id'), 'firms', ['plan_id'], unique=False)
    op.create_table('ledger_entries',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=True),
    sa.Column('actor_type', sa.String(), nullable=False),
    sa.Column('actor_user_id', sa.UUID(), nullable=True),
    sa.Column('actor_name', sa.String(), nullable=False),
    sa.Column('entity_type', sa.String(), nullable=False),
    sa.Column('entity_id', sa.String(), nullable=False),
    sa.Column('entity_label', sa.String(), nullable=False),
    sa.Column('action', sa.String(), nullable=False),
    sa.Column('summary', sa.Text(), nullable=False),
    sa.Column('model_id', sa.String(), nullable=True),
    sa.Column('prompt_version', sa.String(), nullable=True),
    sa.Column('evidence_ids', sa.ARRAY(sa.String()), server_default=sa.text("'{}'::character varying[]"), nullable=False),
    sa.Column('claim_state', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("action IN ('CREATE', 'UPDATE', 'DELETE', 'STATE_CHANGE', 'AI_GENERATE', 'AI_BLOCK', 'AI_OVERRIDE', 'EXPORT', 'LOGIN', 'ADMIN_ACCESS', 'ADMIN_ACCESS_END', 'FIRM_CREATED', 'FIRM_SUSPENDED', 'FIRM_REACTIVATED', 'PLAN_CHANGED', 'INVITE_SENT', 'INVITE_ACCEPTED', 'INVITE_REVOKED')", name='ck_ledger_entries_action'),
    sa.CheckConstraint("actor_type IN ('USER', 'SYSTEM', 'AGENT', 'PLATFORM_ADMIN')", name='ck_ledger_entries_actor_type'),
    sa.CheckConstraint("claim_state IS NULL OR claim_state IN ('VERIFIED', 'UNVERIFIED', 'CONTRADICTED')", name='ck_ledger_entries_claim_state'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ledger_entries_created', 'ledger_entries', ['created_at'], unique=False)
    op.create_index('ix_ledger_entries_firm_created', 'ledger_entries', ['firm_id', 'created_at'], unique=False)
    op.create_table('support_views',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('platform_user_id', sa.UUID(), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("expires_at = started_at + interval '60 minutes'", name='ck_support_views_sixty_minutes'),
    sa.CheckConstraint('char_length(btrim(reason)) >= 10', name='ck_support_views_reason_length'),
    sa.CheckConstraint('ended_at IS NULL OR ended_at >= started_at', name='ck_support_views_ended_after_start'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['platform_user_id'], ['platform_users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_support_views_firm_id'), 'support_views', ['firm_id'], unique=False)
    op.create_index('uq_support_views_one_open_per_admin', 'support_views', ['platform_user_id'], unique=True, postgresql_where=sa.text('ended_at IS NULL'))
    op.create_table('users',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=False),
    sa.Column('role', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('email', sa.String(), nullable=False),
    sa.Column('password_hash', sa.String(), nullable=False),
    sa.Column('avatar_url', sa.String(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('last_active_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("role IN ('OWNER', 'MANAGER', 'BDE', 'VIEWER')", name='ck_users_role'),
    sa.CheckConstraint('email = lower(email)', name='ck_users_email_lowercase'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email'),
    )
    op.create_index(op.f('ix_users_firm_id'), 'users', ['firm_id'], unique=False)
    op.create_index('uq_users_one_active_owner_per_firm', 'users', ['firm_id'], unique=True, postgresql_where=sa.text("role = 'OWNER' AND is_active"))
    op.create_table('invites',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('firm_id', sa.UUID(), nullable=True),
    sa.Column('email', sa.String(), nullable=False),
    sa.Column('invitee_name', sa.String(), nullable=True),
    sa.Column('role', sa.String(), nullable=False),
    sa.Column('invited_by_user_id', sa.UUID(), nullable=True),
    sa.Column('invited_by_platform_user_id', sa.UUID(), nullable=True),
    sa.Column('status', sa.String(), server_default=sa.text("'PENDING'"), nullable=False),
    sa.Column('token_hash', sa.String(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(firm_id IS NULL) = (role = 'PLATFORM_ADMIN')", name='ck_invites_platform_iff_no_firm'),
    sa.CheckConstraint("role IN ('OWNER', 'MANAGER', 'BDE', 'VIEWER', 'PLATFORM_ADMIN')", name='ck_invites_role'),
    sa.CheckConstraint("status <> 'ACCEPTED' OR accepted_at IS NOT NULL", name='ck_invites_accepted_at'),
    sa.CheckConstraint("status <> 'REVOKED' OR revoked_at IS NOT NULL", name='ck_invites_revoked_at'),
    sa.CheckConstraint("status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')", name='ck_invites_status'),
    sa.CheckConstraint("token_hash ~ '^[0-9a-f]{64}$'", name='ck_invites_token_hash_sha256'),
    sa.CheckConstraint('email = lower(email)', name='ck_invites_email_lowercase'),
    sa.CheckConstraint('num_nonnulls(invited_by_user_id, invited_by_platform_user_id) = 1', name='ck_invites_one_inviter'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['invited_by_platform_user_id'], ['platform_users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['invited_by_user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash'),
    )
    op.create_index(op.f('ix_invites_firm_id'), 'invites', ['firm_id'], unique=False)
    op.create_index('uq_invites_one_pending_owner_per_firm', 'invites', ['firm_id'], unique=True, postgresql_where=sa.text("status = 'PENDING' AND role = 'OWNER'"))
    op.create_index('uq_invites_one_pending_per_email', 'invites', ['email'], unique=True, postgresql_where=sa.text("status = 'PENDING'"))
    op.create_table('sessions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('token_hash', sa.String(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('platform_user_id', sa.UUID(), nullable=True),
    sa.Column('support_view_id', sa.UUID(), nullable=True),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('absolute_expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("absolute_expires_at <= created_at + interval '30 days'", name='ck_sessions_thirty_day_cap'),
    sa.CheckConstraint("token_hash ~ '^[0-9a-f]{64}$'", name='ck_sessions_token_hash_sha256'),
    sa.CheckConstraint('expires_at <= absolute_expires_at', name='ck_sessions_expiry_within_cap'),
    sa.CheckConstraint('num_nonnulls(user_id, platform_user_id) = 1', name='ck_sessions_one_account'),
    sa.CheckConstraint('support_view_id IS NULL OR platform_user_id IS NOT NULL', name='ck_sessions_support_view_is_platform'),
    sa.ForeignKeyConstraint(['platform_user_id'], ['platform_users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['support_view_id'], ['support_views.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash'),
    )
    op.create_index(op.f('ix_sessions_platform_user_id'), 'sessions', ['platform_user_id'], unique=False)
    op.create_index(op.f('ix_sessions_user_id'), 'sessions', ['user_id'], unique=False)

    # One email, one account (07 Q9, Q38). The advisory lock on the email makes two concurrent inserts into
    # the two tables wait for each other, so both can't pass the check.
    op.execute("""
        CREATE FUNCTION refuse_email_used_by_other_account() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE other_table text := CASE TG_TABLE_NAME WHEN 'users' THEN 'platform_users' ELSE 'users' END;
                taken boolean;
        BEGIN
            PERFORM pg_advisory_xact_lock(hashtext('account_email:' || NEW.email));
            EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE email = $1)', other_table)
                INTO taken USING NEW.email;
            IF taken THEN
                RAISE EXCEPTION 'email % already belongs to another account', NEW.email
                    USING ERRCODE = 'unique_violation', CONSTRAINT = 'account_email_unique';
            END IF;
            RETURN NEW;
        END $$
    """)
    for table in ("users", "platform_users"):
        op.execute(f"""
            CREATE TRIGGER trg_{table}_email_one_account BEFORE INSERT OR UPDATE OF email ON {table}
            FOR EACH ROW EXECUTE FUNCTION refuse_email_used_by_other_account()
        """)

    # Fixed ids (models/tenancy.py DEFAULT_PLAN_ID / DEFAULT_FIRM_ID): today's data moves into this firm in F2b.
    op.execute("""
        INSERT INTO plans (id, name, seat_limit, candidate_limit)
        VALUES ('00000000-0000-4000-8000-000000000001', 'Default', 10, 100)
    """)
    op.execute("""
        INSERT INTO firms (id, name, slug, status, plan_id, seat_limit, candidate_limit)
        VALUES ('00000000-0000-4000-8000-000000000002', 'Default firm', 'default', 'ACTIVE',
                '00000000-0000-4000-8000-000000000001', 10, 100)
    """)


def downgrade() -> None:
    for table in ("users", "platform_users"):
        op.execute(f"DROP TRIGGER trg_{table}_email_one_account ON {table}")
    op.execute("DROP FUNCTION refuse_email_used_by_other_account()")
    op.drop_index(op.f('ix_sessions_user_id'), table_name='sessions')
    op.drop_index(op.f('ix_sessions_platform_user_id'), table_name='sessions')
    op.drop_table('sessions')
    op.drop_index('uq_invites_one_pending_per_email', table_name='invites', postgresql_where=sa.text("status = 'PENDING'"))
    op.drop_index('uq_invites_one_pending_owner_per_firm', table_name='invites', postgresql_where=sa.text("status = 'PENDING' AND role = 'OWNER'"))
    op.drop_index(op.f('ix_invites_firm_id'), table_name='invites')
    op.drop_table('invites')
    op.drop_index('uq_users_one_active_owner_per_firm', table_name='users', postgresql_where=sa.text("role = 'OWNER' AND is_active"))
    op.drop_index(op.f('ix_users_firm_id'), table_name='users')
    op.drop_table('users')
    op.drop_index('uq_support_views_one_open_per_admin', table_name='support_views', postgresql_where=sa.text('ended_at IS NULL'))
    op.drop_index(op.f('ix_support_views_firm_id'), table_name='support_views')
    op.drop_table('support_views')
    op.drop_index('ix_ledger_entries_firm_created', table_name='ledger_entries')
    op.drop_index('ix_ledger_entries_created', table_name='ledger_entries')
    op.drop_table('ledger_entries')
    op.drop_index(op.f('ix_firms_plan_id'), table_name='firms')
    op.drop_table('firms')
    op.drop_table('platform_users')
    op.drop_table('plans')
