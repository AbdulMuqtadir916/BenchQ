"""Background events in the activity log: what the scrapers, scorers, Gmail and Telegram jobs did.

They are system rows with no firm, so only the Super Admin reads them: every firm reader's rows are scoped to its firm.
"""
import json
import logging
import uuid

from backend.auth import ledger
from backend.models.db import SessionLocal

logger = logging.getLogger("jobnavigator.activity")

ACTORS = {"scrape": "Scraper", "h1b": "H-1B refresh", "cv_score": "Résumé scoring", "email": "Email monitor",
          "telegram": "Telegram digest"}


def log_activity(type: str, message: str, company: str = None, details: dict = None, db=None, is_empty: bool = False):
    """Log a background event, unless `is_empty`: a run that did nothing leaves no row. Opens its own session if `db`
    isn't given. A log that can't be written never stops the work."""
    if is_empty:
        return
    own_session = db is None
    if own_session:
        db = SessionLocal()
    try:
        actor = ACTORS.get(type, type)
        ledger.record_automated(db, actor_type="SYSTEM", actor_name=actor, action="CREATE", entity_type="system_event",
                                entity_id=uuid.uuid4(), entity_label=company or actor, summary=message, firm_id=None,
                                candidate_id=None, note=json.dumps(details) if details else None)
        if own_session:
            db.commit()
        else:
            db.flush()
    except Exception as e:
        logger.warning(f"Failed to log activity: {e}")
        if own_session:
            db.rollback()
    finally:
        if own_session:
            db.close()
