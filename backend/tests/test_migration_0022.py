"""Migration 0022: nothing is lost, and the two old log tables are gone."""
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, inspect, text

from backend.tests.test_activity_logs import _alembic, at_0015  # noqa: F401  (a fixture, used by name)

WHEN = datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc)


def _at_0021(url):
    _alembic(url, "upgrade", "0021")


def test_every_old_row_is_copied_before_the_tables_go(at_0015):
    url, engine = at_0015
    _at_0021(url)
    scrape, score, ledger = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("""INSERT INTO activity_log_v2 (id, type, message, company, details, created_at)
                             VALUES (:id, 'scrape', 'Acme: 3 new', 'Acme', '{"new": 3}', :when)"""), {"id": scrape, "when": WHEN})
        conn.execute(text("""INSERT INTO activity_log_v2 (id, type, message, details, created_at)
                             VALUES (:id, 'cv_score', 'Resume scoring complete: 0 jobs processed', 'null', :when)"""),
                     {"id": score, "when": WHEN})
        conn.execute(text("""INSERT INTO ledger_entries (id, actor_type, actor_name, entity_type, entity_id, entity_label, action,
                                                         summary, created_at)
                             VALUES (:id, 'SYSTEM', 'script', 'firm', 'x', 'x', 'CREATE', 'Written late', :when)"""),
                     {"id": ledger, "when": WHEN})
    _alembic(url, "upgrade", "head")
    tables = set(inspect(engine).get_table_names())
    assert not {"activity_log_v2", "ledger_entries"} & tables
    with engine.connect() as conn:
        rows = {row.id: row for row in conn.execute(text("SELECT * FROM activity_logs"))}
    assert set(rows) == {scrape, score, ledger}
    copied = rows[scrape]
    assert (copied.actor_type, copied.actor_name, copied.action, copied.firm_id) == ("SYSTEM", "Scraper", "CREATE", None)
    assert (copied.entity_label, copied.summary, copied.created_at) == ("Acme", "Acme: 3 new", WHEN)
    assert copied.note == '{"new": 3}'
    assert (rows[score].actor_name, rows[score].entity_label, rows[score].note) == ("Résumé scoring", "Résumé scoring", None)
    assert rows[ledger].summary == "Written late"


def test_the_downgrade_brings_both_tables_back_empty(at_0015):
    url, engine = at_0015
    _alembic(url, "upgrade", "head")
    _alembic(url, "downgrade", "0021")
    tables = set(inspect(engine).get_table_names())
    assert {"activity_log_v2", "ledger_entries"} <= tables
    _alembic(url, "upgrade", "head")
