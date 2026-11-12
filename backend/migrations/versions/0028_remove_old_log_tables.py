"""`activity_logs` is the one log: `activity_log_v2` and `ledger_entries` are removed.

- Every `activity_log_v2` row is copied in as a system row with no firm, so only the Super Admin reads it. Each keeps its
  id, date and message; its company becomes the label and its details the note.
- Any `ledger_entries` row not already copied by 0026 comes in the same way 0026 did it.
- The upgrade stops if a row is missing, before anything is dropped.

The downgrade brings both tables back empty. What was copied stays in `activity_logs`.

Revision ID: 0028
Revises: 0027
"""
from alembic import op
import sqlalchemy as sa

revision = '0028'
down_revision = '0027'
branch_labels = None
depends_on = None

ACTIONS = ("'CREATE', 'UPDATE', 'DELETE', 'STATE_CHANGE', 'AI_GENERATE', 'AI_BLOCK', 'AI_OVERRIDE', 'EXPORT', 'LOGIN', "
           "'ADMIN_ACCESS', 'ADMIN_ACCESS_END', 'FIRM_CREATED', 'FIRM_SUSPENDED', 'FIRM_REACTIVATED', 'PLAN_CHANGED', "
           "'INVITE_SENT', 'INVITE_ACCEPTED', 'INVITE_REVOKED', 'ASSIGN'")
SHARED = ("id, firm_id, actor_type, actor_user_id, actor_name, entity_type, entity_id, entity_label, action, summary, "
          "note, model_id, prompt_version, candidate_id, created_at")
ACTOR = ("CASE type WHEN 'scrape' THEN 'Scraper' WHEN 'h1b' THEN 'H-1B refresh' WHEN 'cv_score' THEN 'Résumé scoring' "
         "WHEN 'email' THEN 'Email monitor' WHEN 'telegram' THEN 'Telegram digest' ELSE type END")


def upgrade():
    op.execute(f"""
        INSERT INTO activity_logs (id, firm_id, actor_type, actor_name, entity_type, entity_id, entity_label, action,
                                   summary, note, created_at)
        SELECT v.id, NULL, 'SYSTEM', {ACTOR}, 'system_event', v.id::text, COALESCE(v.company, {ACTOR}), 'CREATE',
               v.message, NULLIF(v.details::text, 'null'), COALESCE(v.created_at, now())
        FROM activity_log_v2 v
        WHERE NOT EXISTS (SELECT 1 FROM activity_logs a WHERE a.id = v.id)
    """)
    op.execute(f"""
        INSERT INTO activity_logs ({SHARED}, actor_role, team_manager_id, candidate_manager_id, candidate_bde_id)
        SELECT {', '.join(f'l.{column}' for column in SHARED.split(', '))},
               CASE WHEN l.actor_type = 'PLATFORM_ADMIN' THEN 'PLATFORM_ADMIN' ELSE u.role END,
               CASE u.role WHEN 'MANAGER' THEN u.id WHEN 'BDE' THEN u.manager_id END,
               c.manager_id, c.bde_id
        FROM ledger_entries l
        LEFT JOIN users u ON l.actor_type = 'USER' AND u.id = l.actor_user_id
        LEFT JOIN candidates c ON c.id = l.candidate_id AND c.firm_id = l.firm_id
        WHERE NOT EXISTS (SELECT 1 FROM activity_logs a WHERE a.id = l.id)
    """)
    connection = op.get_bind()
    for table in ('activity_log_v2', 'ledger_entries'):
        missing = connection.execute(sa.text(
            f"SELECT count(*) FROM {table} t WHERE NOT EXISTS (SELECT 1 FROM activity_logs a WHERE a.id = t.id)")).scalar()
        if missing:
            raise RuntimeError(f"{missing} rows of {table} are not in activity_logs; nothing was dropped.")
    op.drop_table('activity_log_v2')
    op.drop_table('ledger_entries')


def downgrade():
    op.create_table('activity_log_v2',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('type', sa.String(), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('company', sa.String(), nullable=True),
    sa.Column('details', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
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
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('model_id', sa.String(), nullable=True),
    sa.Column('prompt_version', sa.String(), nullable=True),
    sa.Column('candidate_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint(f"action IN ({ACTIONS})", name='ck_ledger_entries_action'),
    sa.CheckConstraint("actor_type IN ('USER', 'SYSTEM', 'AGENT', 'PLATFORM_ADMIN')", name='ck_ledger_entries_actor_type'),
    sa.ForeignKeyConstraint(['firm_id'], ['firms.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ledger_entries_created', 'ledger_entries', ['created_at'], unique=False)
    op.create_index('ix_ledger_entries_firm_created', 'ledger_entries', ['firm_id', 'created_at'], unique=False)
    op.create_index('ix_ledger_entries_firm_candidate_created', 'ledger_entries', ['firm_id', 'candidate_id', 'created_at'],
                    unique=False)
