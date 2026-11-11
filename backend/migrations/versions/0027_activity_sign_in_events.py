"""Sign-out, failed sign-ins and lockouts in the activity log.

- `activity_logs` takes three more actions and an UNKNOWN actor, for an email with no account.
- `ip_address` is kept on failed sign-ins. `attempt_count` lets repeat tries share a row.
- The append-only trigger now allows one thing: adding 1 to a failed sign-in's `attempt_count`.

Revision ID: 0027
Revises: 0026
"""
from alembic import op
import sqlalchemy as sa

revision = '0027'
down_revision = '0026'
branch_labels = None
depends_on = None

OLD_ACTIONS = ("'CREATE', 'UPDATE', 'DELETE', 'STATE_CHANGE', 'AI_GENERATE', 'AI_BLOCK', 'AI_OVERRIDE', 'EXPORT', 'LOGIN', "
               "'ADMIN_ACCESS', 'ADMIN_ACCESS_END', 'FIRM_CREATED', 'FIRM_SUSPENDED', 'FIRM_REACTIVATED', 'PLAN_CHANGED', "
               "'INVITE_SENT', 'INVITE_ACCEPTED', 'INVITE_REVOKED', 'ASSIGN'")
NEW_ACTIONS = "'LOGOUT', 'SIGN_IN_FAILED', 'LOCKED_OUT'"
OLD_ACTOR_TYPES = "'USER', 'SYSTEM', 'AGENT', 'PLATFORM_ADMIN'"


def _checks(actions: str, actor_types: str):
    op.drop_constraint('ck_activity_logs_action', 'activity_logs', type_='check')
    op.drop_constraint('ck_activity_logs_actor_type', 'activity_logs', type_='check')
    op.create_check_constraint('ck_activity_logs_action', 'activity_logs', f"action IN ({actions})")
    op.create_check_constraint('ck_activity_logs_actor_type', 'activity_logs', f"actor_type IN ({actor_types})")


def _trigger(allow_count: bool):
    allowed = """
            IF TG_OP = 'UPDATE' AND OLD.action = 'SIGN_IN_FAILED' AND NEW.attempt_count = OLD.attempt_count + 1
               AND to_jsonb(NEW) - 'attempt_count' = to_jsonb(OLD) - 'attempt_count' THEN
                RETURN NEW;
            END IF;""" if allow_count else ""
    op.execute(f"""
        CREATE OR REPLACE FUNCTION activity_logs_append_only() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' AND current_setting('benchq.activity_logs_demo_reset', true) = 'on' THEN
                RETURN OLD;
            END IF;{allowed}
            RAISE EXCEPTION 'activity_logs is append-only' USING ERRCODE = 'restrict_violation';
        END
        $$ LANGUAGE plpgsql
    """)


def upgrade():
    op.add_column('activity_logs', sa.Column('ip_address', sa.String(), nullable=True))
    op.add_column('activity_logs', sa.Column('attempt_count', sa.Integer(), server_default=sa.text('1'), nullable=False))
    _checks(f"{OLD_ACTIONS}, {NEW_ACTIONS}", f"{OLD_ACTOR_TYPES}, 'UNKNOWN'")
    op.create_check_constraint('ck_activity_logs_attempt_count', 'activity_logs', "attempt_count >= 1")
    op.create_index('ix_activity_logs_action_created', 'activity_logs', ['action', 'created_at'])
    _trigger(allow_count=True)


def downgrade():
    # These rows have no place in the older log, so they go. The demo reset's switch is what lets a DELETE through.
    op.execute("SET LOCAL benchq.activity_logs_demo_reset = 'on'")
    op.execute(f"DELETE FROM activity_logs WHERE action IN ({NEW_ACTIONS}) OR actor_type = 'UNKNOWN'")
    op.execute("SET LOCAL benchq.activity_logs_demo_reset = 'off'")
    _trigger(allow_count=False)
    op.drop_index('ix_activity_logs_action_created', table_name='activity_logs')
    op.drop_constraint('ck_activity_logs_attempt_count', 'activity_logs', type_='check')
    _checks(OLD_ACTIONS, OLD_ACTOR_TYPES)
    op.drop_column('activity_logs', 'attempt_count')
    op.drop_column('activity_logs', 'ip_address')
