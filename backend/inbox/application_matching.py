"""Conservative application identity matching, independent of email classification.

Only complete company and role names identify a posting. There is no fuzzy score,
sender-domain inference, category keyword matching, or cross-candidate fallback.
"""
from __future__ import annotations

import re
import unicodedata
from typing import NamedTuple

from sqlalchemy import and_, or_

from backend.auth.scoping import scoped
from backend.models.candidates import InboxMessage
from backend.models.db import Application, Company, Job

_TOKEN = re.compile(r"\w+(?:\+\+|#)?", re.UNICODE)
_BOUNDARY = re.compile(r"[\n\r:;|()\[\]!?.,\u2013\u2014]|\s-\s")
# A connecting word may border a name in prose. An adjoining name qualifier
# (Senior, II, International, etc.) cannot silently become a partial-name match.
_BEFORE = frozenset({"at", "to", "with", "from", "for", "the", "a", "an", "as", "and",
                     "company", "employer", "title", "role", "position", "regarding", "about",
                     "your", "our", "re", "fw", "fwd"})
_AFTER = frozenset({"at", "with", "from", "for", "and", "role", "position", "job", "application",
                    "opening", "opportunity", "has", "have", "is", "are", "was", "were",
                    "requires", "regarding", "about", "your", "we"})


class _Segment(NamedTuple):
    text: str
    words: tuple
    tokens: tuple[str, ...]


def _text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    value = re.sub(r"(?<!\w)\.net\b", "dotnet", value)
    return value.replace("&", " and ")


def _name(value: str) -> tuple[str, ...]:
    return tuple(_TOKEN.findall(_text(value)))


def _title(value: str) -> str:
    # Existing local fixture titles include provenance, not part of the role.
    # Only this explicit wrapper is optional; seniority/contract/level text stays.
    fixture = re.fullmatch(r"\[QA-\d+\]\s*(.+?)\s*\(Synthetic\)", value, re.IGNORECASE)
    return fixture[1] if fixture else value


def _segment(value: str) -> _Segment:
    text = _text(value)
    words = tuple(_TOKEN.finditer(text))
    return _Segment(text, words, tuple(word[0] for word in words))


def _mentions(segment: _Segment, name: tuple[str, ...]) -> bool:
    if not name:
        return False
    text, words, tokens = segment
    for start in range(len(words) - len(name) + 1):
        end = start + len(name)
        if tokens[start:end] != name:
            continue
        before = (start == 0 or tokens[start - 1] in _BEFORE
                  or _BOUNDARY.search(text[words[start - 1].end():words[start].start()]))
        after = (end == len(words) or tokens[end] in _AFTER
                 or _BOUNDARY.search(text[words[end - 1].end():words[end].start()]))
        if before and after:
            return True
    return False


def submitted_applications(db, firm_id, candidate_id):
    """Durable submission evidence keeps later stages eligible; a Saved draft has neither."""
    return scoped(db, Application, firm_id).filter(
        Application.candidate_id == candidate_id,
        # Historical Saved inserts may have received the model's default date.
        # That timestamp alone is not proof that a draft was submitted.
        or_(and_(Application.status != "saved", Application.applied_at.isnot(None)),
            Application.submitted_by_user_id.isnot(None)),
    )


def _thread_links(db, mailbox, thread_id: str | None, source_address: str | None = None):
    if not thread_id:
        return []
    applications = submitted_applications(db, mailbox.firm_id, mailbox.candidate_id).with_entities(Application.id)
    return scoped(db, InboxMessage, mailbox.firm_id, InboxMessage.application_id).filter(
        InboxMessage.candidate_id == mailbox.candidate_id,
        InboxMessage.mailbox_id == mailbox.id,
        InboxMessage.source_address.in_(["", source_address or mailbox.address.strip().lower()]),
        InboxMessage.thread_id == thread_id,
        InboxMessage.application_id.in_(applications),
    ).distinct().limit(2).all()


def thread_application_id(db, mailbox, thread_id: str | None):
    """Reuse one existing link only if it still belongs to this candidate/firm."""
    links = _thread_links(db, mailbox, thread_id)
    return links[0][0] if len(links) == 1 else None


def matching_application_id(db, mailbox, message):
    """Find a unique submitted application by thread or full company+title mentions."""
    links = _thread_links(db, mailbox, message.thread_id, message.source_address)
    if links:
        # Conflicting existing thread links cannot be overridden by a name guess.
        return links[0][0] if len(links) == 1 else None
    # Subject/body are separate evidence segments; never form a name across their boundary.
    segments = [_segment(message.subject or ""), _segment(message.body or message.snippet or "")]
    applications = submitted_applications(db, mailbox.firm_id, mailbox.candidate_id).join(
        Job, Application.job_id == Job.id).with_entities(Application.id, Job.company, Job.title).all()
    companies = db.query(Company.name, Company.aliases).all()  # Global reference data.
    aliases = {}
    for company, names in companies:
        group = {_name(company), *(_name(name) for name in (names or []) if isinstance(name, str))}
        for name in group:
            aliases.setdefault(name, set()).update(group)
    matches = set()
    for app_id, company, title in applications:
        if not company or not title:
            continue
        company_name = _name(company)
        names = aliases.get(company_name, {company_name})
        if (any(_mentions(segment, _name(_title(title))) for segment in segments)
                and any(_mentions(segment, name) for segment in segments for name in names)):
            matches.add(app_id)
    return next(iter(matches)) if len(matches) == 1 else None
