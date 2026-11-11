"""Drop `firms.truth_guard_mode` (decided 2026-11-05: BenchQ has no claim states, so no Truth Guard setting)

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-05 12:00:00.000000

`truth_guard_mode` (STRICT / BALANCED / LENIENT, default BALANCED) was the firm's setting for how hard the old claim
states were enforced. Nothing reads it; the claim states, the `claims` and `evidence` tables and the export gate are
gone (0015 and the frontend). The column and its CHECK are dropped. **The value each firm had is lost**; BenchQ ships
on a fresh database and no code used it, so nothing is converted.

The downgrade adds the column back with its CHECK and every firm on BALANCED, the default.
"""

from alembic import op
import sqlalchemy as sa

revision = '0016'
down_revision = '0015'
branch_labels = None
depends_on = None

MODES = ("STRICT", "BALANCED", "LENIENT")


def upgrade() -> None:
    op.drop_constraint('ck_firms_truth_guard_mode', 'firms', type_='check')
    op.drop_column('firms', 'truth_guard_mode')


def downgrade() -> None:
    op.add_column('firms', sa.Column('truth_guard_mode', sa.String(), nullable=False, server_default=sa.text("'BALANCED'")))
    values = ", ".join(f"'{m}'" for m in MODES)
    op.create_check_constraint('ck_firms_truth_guard_mode', 'firms', f"truth_guard_mode IN ({values})")
