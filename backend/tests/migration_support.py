"""Migration tests that cross 0026/0027 (applications onto `job_postings`) while applications name old `jobs` rows: on
the way up the local move (`backend/scripts/move_local_jobs_to_postings.py`) runs at 0026, and on the way down its
undo, as on a developer's database."""

from backend.tests.test_migration_0002 import _alembic, _ok


def upgrade_head(name, engine):
    """Up to 0026, the move onto postings, then head."""
    from backend.scripts.move_local_jobs_to_postings import move

    _ok(_alembic(name, "upgrade", "0026"))
    with engine.begin() as conn:
        move(conn)
    _ok(_alembic(name, "upgrade", "head"))


def down_to_0026(name, engine):
    """Down to 0026 with the applications back on their old jobs (the move's undo), so a downgrade can go past it."""
    from backend.scripts.move_local_jobs_to_postings import undo

    _ok(_alembic(name, "downgrade", "0026"))
    with engine.begin() as conn:
        undo(conn)


def downgrade_to(name, engine, target):
    """Down to `target`, below 0026."""
    down_to_0026(name, engine)
    _ok(_alembic(name, "downgrade", target))
