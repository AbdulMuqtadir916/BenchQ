"""The activity log: a new table, filled from the ledger, that can only be added to.

- `activity_logs`: the columns of `ledger_entries`, plus who an AI acted for, the actor's role and team at the time, the
  candidate's manager and BDE at the time, before/after values and the request id.
- Every `ledger_entries` row is copied, with its id and date. Those rows can't know the past, so their stamps come from
  today's roles and assignments. `ledger_entries` itself is left as it was.
- A trigger refuses UPDATE and DELETE, so no code path can rewrite history.

Revision ID: 0020
Revises: 0019
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0020'
down_revision = '0019'
branch_labels = None
depends_on = None

ACTOR_TYPES = "'USER', 'SYSTEM', 'AGENT', 'PLATFORM_ADMIN'"
ACTOR_ROLES = "'OWNER', 'MANAGER', 'BDE', 'VIEWER', 'PLATFORM_ADMIN'"
ACTIONS = ("'CREATE', 'UPDATE', 'DELETE', 'STATE_CHANGE', 'AI_GENERATE', 'AI_BLOCK', 'AI_OVERRIDE', 'EXPORT', 'LOGIN', "
           "'ADMIN_ACCESS', 'ADMIN_ACCESS_END', 'FIRM_CREATED', 'FIRM_SUSPENDED', 'FIRM_REACTIVATED', 'PLAN_CHANGED', "
           "'INVITE_SENT', 'INVITE_ACCEPTED', 'INVITE_REVOKED', 'ASSIGN'")
SHARED = ("id, firm_id, actor_type, actor_user_id, actor_name, entity_type, entity_id, entity_label, action, summary, "
          "note, model_id, prompt_version, candidate_id, created_at")


def upgrade():
    op.create_table(
        'activity_logs',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('firm_id', sa.UUID(), nullable=True),
        sa.Column('actor_type', sa.String(), nullable=False),
        sa.Column('actor_user_id', sa.UUID(), nullable=True),
        sa.Column('actor_name', sa.String(), nullable=False),
        sa.Column('actor_role', sa.String(), nullable=True),
        sa.Column('on_behalf_of_user_id', sa.UUID(), nullable=True),
        sa.Column('team_manager_id', sa.UUID(), nullable=True),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('entity_id', sa.String(), nullable=False),
        sa.Column('entity_label', sa.String(), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('changes', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('request_id', sa.String(), nullable=True),
        sa.Column('model_id', sa.String(), nullable=True),
        sa.Column('prompt_version', sa.String(), nullable=True),
        sa.Column('candidate_id', sa.UUID(), nullable=True),
        sa.Column('candidate_manager_id', sa.UUID(), nullable=True),
        sa.Column('candidate_bde_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(f"actor_type IN ({ACTOR_TYPES})", name='ck_activity_logs_actor_type'),
        sa.CheckConstraint(f"actor_role IS NULL OR actor_role IN ({ACTOR_ROLES})", name='ck_activity_logs_actor_role'),
        sa.CheckConstraint(f"action IN ({ACTIONS})", name='ck_activity_logs_action'),
        sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_activity_logs_created', 'activity_logs', ['created_at'])
    op.create_index('ix_activity_logs_firm_created', 'activity_logs', ['firm_id', 'created_at', 'id'])
    op.create_index('ix_activity_logs_firm_candidate_created', 'activity_logs', ['firm_id', 'candidate_id', 'created_at'])
    op.create_index('ix_activity_logs_firm_actor_created', 'activity_logs', ['firm_id', 'actor_user_id', 'created_at'])
    op.create_index('ix_activity_logs_firm_behalf_created', 'activity_logs',
                    ['firm_id', 'on_behalf_of_user_id', 'created_at'])
    op.create_index('ix_activity_logs_firm_team_created', 'activity_logs', ['firm_id', 'team_manager_id', 'created_at'])

    op.execute(f"""
        INSERT INTO activity_logs ({SHARED}, actor_role, team_manager_id, candidate_manager_id, candidate_bde_id)
        SELECT {', '.join(f'l.{column}' for column in SHARED.split(', '))},
               CASE WHEN l.actor_type = 'PLATFORM_ADMIN' THEN 'PLATFORM_ADMIN' ELSE u.role END,
               CASE u.role WHEN 'MANAGER' THEN u.id WHEN 'BDE' THEN u.manager_id END,
               c.manager_id, c.bde_id
        FROM ledger_entries l
        LEFT JOIN users u ON l.actor_type = 'USER' AND u.id = l.actor_user_id
        LEFT JOIN candidates c ON c.id = l.candidate_id AND c.firm_id = l.firm_id
    """)

    # A delete is let through only by the demo reset, which names itself for one transaction (scripts/seed_demo.py).
    op.execute("""
        CREATE FUNCTION activity_logs_append_only() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' AND current_setting('benchq.activity_logs_demo_reset', true) = 'on' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'activity_logs is append-only' USING ERRCODE = 'restrict_violation';
        END
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER activity_logs_append_only BEFORE UPDATE OR DELETE ON activity_logs
        FOR EACH ROW EXECUTE FUNCTION activity_logs_append_only()
    """)


def downgrade():
    # Entries written since the upgrade go back to the ledger, so history survives; the new columns have nowhere to go.
    op.execute(f"""
        INSERT INTO ledger_entries ({SHARED})
        SELECT {SHARED} FROM activity_logs a
        WHERE NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.id = a.id)
    """)
    op.execute("DROP TRIGGER activity_logs_append_only ON activity_logs")
    op.execute("DROP FUNCTION activity_logs_append_only()")
    op.drop_table('activity_logs')
