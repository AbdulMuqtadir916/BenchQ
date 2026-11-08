"""The answer bank the extension fills application forms from, for one candidate in the caller's scope."""

import logging
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.api.routes_auth import current_principal
from backend.api.routes_candidates import _candidate
from backend.auth.scoping import reader_firm_id
from backend.auth.sessions import Principal
from backend.models.db import get_db


logger = logging.getLogger("jobnavigator.autofill")

router = APIRouter(prefix="/autofill", tags=["autofill"])


def _qa_pair(entry) -> tuple:
    """Normalise one qa_bank entry to (question, answer); accepts both the canonical {"question","answer"} shape written by POST /persona/qa-bank and a legacy single-key {"<question>": "<answer>"} map."""
    if not isinstance(entry, dict):
        return "", ""

    if "question" in entry or "answer" in entry:
        return str(entry.get("question") or ""), str(entry.get("answer") or "")

    for k, v in entry.items():
        return str(k or ""), str(v or "")

    return "", ""


def _bank_entries(bank) -> list[dict]:
    """The bank as the extension reads it: every entry with a question and an answer, and only the fields it fills from. An entry's verification state and evidence stay out: being in the bank is what makes an answer usable."""
    entries = []

    for index, entry in enumerate(bank or []):
        question, answer = (text.strip() for text in _qa_pair(entry))

        if question and answer:
            entries.append(
                {
                    "id": str(entry.get("id") or f"qa-{index}"),
                    "question": question,
                    "answer": answer,
                    "category": str(entry.get("category") or "OTHER"),
                }
            )

    return entries


@router.get("/config")
def autofill_config(
    candidate_id: uuid.UUID,
    principal: Principal = Depends(current_principal),
    firm_id: uuid.UUID = Depends(reader_firm_id),
    db: Session = Depends(get_db),
):
    """One candidate's answer bank, all the extension needs: it reads the form and does the matching and filling itself. Not found outside the caller's scope."""

    logger.info("Autofill config requested")

    try:
        candidate = _candidate(db, firm_id, principal, candidate_id)
        entries = _bank_entries(candidate.qa_bank)

        logger.info("Autofill config loaded successfully: %d QA entries", len(entries))

        return {
            "candidate_id": str(candidate.id),
            "qa_bank": entries,
        }

    except Exception:
        logger.exception("Failed to load autofill config")
        raise
