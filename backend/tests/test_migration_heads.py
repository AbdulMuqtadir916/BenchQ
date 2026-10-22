"""The migrations form one line: exactly one head (CONTRIBUTING.md, "Migrations").

Two PRs that each add the next revision both pass on their own and leave two heads once both are merged, and
`db_upgrade` then refuses to start. This test fails the second PR instead: rebase it, then point its revision's
`down_revision` at the new head and renumber the file.
"""
from alembic.script import ScriptDirectory

from backend.db_schema import _config


def test_migrations_have_one_head():
    heads = ScriptDirectory.from_config(_config()).get_heads()
    assert len(heads) == 1, (
        f"Alembic has {len(heads)} heads: {sorted(heads)}. Another PR merged a revision first: rebase onto main, "
        "set your revision's down_revision to the other head and renumber the file."
    )
