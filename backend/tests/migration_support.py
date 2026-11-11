"""Migration tests that cross 0024/0025 (applications onto `job_postings`) while applications name old `jobs` rows: on
the way up the local move (`backend/scripts/move_local_jobs_to_postings.py`) runs at 0024, and on the way down its
undo, as on a developer's database."""

from backend.tests.test_migration_0002 import _alembic, _ok


def upgrade_head(name, engine):
    """Up to 0024, the move onto postings, then head."""
    from backend.scripts.move_local_jobs_to_postings import move

    _ok(_alembic(name, "upgrade", "0024"))
    with engine.begin() as conn:
        move(conn)
    _ok(_alembic(name, "upgrade", "head"))


def down_to_0024(name, engine):
    """Down to 0024 with the applications back on their old jobs (the move's undo), so a downgrade can go past it."""
    from backend.scripts.move_local_jobs_to_postings import undo

    _ok(_alembic(name, "downgrade", "0024"))
    with engine.begin() as conn:
        undo(conn)


def downgrade_to(name, engine, target):
    """Down to `target`, below 0024."""
    down_to_0024(name, engine)
    _ok(_alembic(name, "downgrade", target))
