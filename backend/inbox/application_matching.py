"""Conservative application identity matching, independent of email classification.

Only complete company and role names identify a posting. There is no fuzzy score,
sender-domain inference, category keyword matching, or cross-candidate fallback.
"""
from __future__ import annotations

import re
import unicodedata
from typing import NamedTuple

from sqlalchemy import or_

from backend.auth.scoping import scoped
from backend.models.candidates import InboxMessage
from backend.inbox.google_oauth import decrypt_content
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


def is_match_eligible(app) -> bool:
    """The one rule for which applications an email may identify (DEBUG D-07): any status except Saved (including
    Incomplete), or a recorded submitter. Matching eligibility is separate from submission evidence: `applied_at`
    is not required, so Saved → Screening call is matchable and its meaning is never changed."""
    return app is not None and app.candidate_id is not None and (app.status != "saved" or app.submitted_by_user_id is not None)


def submitted_applications(db, firm_id, candidate_id):
    """Query form of `is_match_eligible` for one candidate (matching, worker, review dropdown)."""
    return scoped(db, Application, firm_id).filter(
        Application.candidate_id == candidate_id,
        or_(Application.status != "saved", Application.submitted_by_user_id.isnot(None)),
    )


def _thread_links(db, mailbox, thread_id: str | None, source_address: str | None = None):
    if not thread_id:
        return []
    applications = submitted_applications(db, mailbox.firm_id, mailbox.candidate_id).with_entities(Application.id)
    return scoped(db, InboxMessage, mailbox.firm_id, InboxMessage.application_id).filter(
        InboxMessage.candidate_id == mailbox.candidate_id,
        InboxMessage.mailbox_id == mailbox.id,
        InboxMessage.source_address == (source_address or mailbox.address.strip().lower()),
        InboxMessage.thread_id == thread_id,
        InboxMessage.deleted_at.is_(None),
        InboxMessage.application_id.in_(applications),
    ).distinct().limit(2).all()


def company_aliases(db) -> dict:
    """Every company name -> the full set of names of its alias group (global reference data). Built once per worker
    sweep and passed to each email (PR 4, DEBUG D-21)."""
    aliases = {}
    for company, names in db.query(Company.name, Company.aliases).all():
        group = {_name(company), *(_name(name) for name in (names or []) if isinstance(name, str))}
        for name in group:
            aliases.setdefault(name, set()).update(group)
    return aliases


def matching_application_id(db, mailbox, message, *, allow_thread=False, aliases=None):
    """Return identity evidence only, never mutate a link/review/application.

    Thread reuse defaults off until caller has independently established trustworthy
    sender/job context. A match alone is never permission to update status.
    """
    if (message.deleted_at is not None or message.firm_id != mailbox.firm_id
            or message.candidate_id != mailbox.candidate_id or message.mailbox_id != mailbox.id
            or not message.source_address or message.source_address != mailbox.address.strip().lower()):
        return None
    links = _thread_links(db, mailbox, message.thread_id, message.source_address) if allow_thread else []
    if links:
        # Conflicting existing thread links cannot be overridden by a name guess.
        return links[0][0] if len(links) == 1 else None
    # Subject/body are separate evidence segments; never form a name across their boundary. Forwarded history may
    # identify the application (forwards always go to review); quoted reply history never does.
    parts = email_parts(message)
    segments = [_segment(parts.subject), _segment(parts.current)]
    if parts.is_forward and parts.forwarded:
        segments.append(_segment(parts.forwarded))
    applications = submitted_applications(db, mailbox.firm_id, mailbox.candidate_id).join(
        Job, Application.job_id == Job.id).with_entities(Application.id, Job.company, Job.title).all()
    if aliases is None:
        aliases = company_aliases(db)  # a single email outside a sweep
    matches = set()
    for app_id, company, title in applications:
        if not company or not title:
            continue
        company_name = _name(company)
        names = aliases.get(company_name, {company_name})
        if (any(_mentions(segment, _name(title)) for segment in segments)
                and any(_mentions(segment, name) for segment in segments for name in names)):
            matches.add(app_id)
    return next(iter(matches)) if len(matches) == 1 else None


class EmailParts(NamedTuple):
    subject: str
    current: str        # the sender's own new text: the only decision evidence
    forwarded: str      # forwarded history: identity evidence only, never a current decision
    is_forward: bool


MIN_CURRENT_TEXT = 20

_REPLY_HEADER = re.compile(r'^(?:on\b.{0,300}\bwrote:|-{2,}\s*original message\s*-{2,})\s*$', re.I)
_FORWARD_HEADER = re.compile(r'^(?:-{2,}\s*forwarded message\s*-{2,}|begin forwarded message:)\s*$', re.I)
_FORWARD_SUBJECT = re.compile(r'^\s*(?:fwd?|fw)\s*:', re.I)
_SIGN_OFF = re.compile(r'^(?:--|(?:best |kind |warm |many )?regards[,!.]?|thanks(?: (?:and|&) regards)?[,!.]?'
                       r'|thank you[,!.]?|sincerely[,!.]?|cheers[,!.]?|sent from my .+)$', re.I)
_OUTLOOK_FIELD = re.compile(r'^(?:sent|date|to|subject|cc):', re.I)
_SIGNATURE_LINES = 8
_SIGNATURE_LINE_LENGTH = 80


def _is_reply_header(lines, index):
    text = lines[index].strip()
    if _REPLY_HEADER.match(text):
        return True
    # Outlook-style quoted header: "From:" followed closely by Sent/Date/To/Subject. A single mid-body
    # line starting with "From:" is ordinary text, never a cut point.
    return (text.lower().startswith('from:')
            and any(_OUTLOOK_FIELD.match(line.strip()) for line in lines[index + 1:index + 4]))


def _strip_sign_off(lines):
    """Remove a trailing signature: a sign-off line followed by at most a few short lines."""
    for index, line in enumerate(lines):
        tail = [item for item in lines[index + 1:] if item.strip()]
        if (_SIGN_OFF.match(line.strip()) and len(tail) <= _SIGNATURE_LINES
                and all(len(item.strip()) <= _SIGNATURE_LINE_LENGTH for item in tail)):
            return lines[:index]
    return lines


def _split(value, subject):
    """(current, forwarded, is_forward) — separate rules for replies and forwards (DEBUG D-04)."""
    forwarded = ''
    if re.search(r'<(?:html|body|div|p|br)\b', value, re.IGNORECASE):
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(value, 'html.parser')
        for quote in soup.select('.gmail_quote'):
            if 'forwarded message' in quote.get_text(' ').lower() and not forwarded:
                forwarded = quote.get_text('\n')
                quote.decompose()
        for quoted in soup.select('blockquote, .gmail_quote, .gmail_signature, script, style'):
            quoted.decompose()
        value = soup.get_text('\n')
    lines = value.splitlines()
    reply = next((i for i in range(len(lines)) if _is_reply_header(lines, i)), None)
    forward = next((i for i, line in enumerate(lines) if _FORWARD_HEADER.match(line.strip())), None)
    if forward is not None and (reply is None or forward < reply):
        forwarded = '\n'.join(lines[forward + 1:]) or forwarded
        lines = lines[:forward]
    elif reply is not None:
        lines = lines[:reply]
    lines = _strip_sign_off([line for line in lines if not line.lstrip().startswith('>')])
    current = '\n'.join(lines).strip()
    forwarded = '\n'.join(line for line in forwarded.splitlines() if not line.lstrip().startswith('>')).strip()
    is_forward = bool(forwarded) or bool(_FORWARD_SUBJECT.match(subject or ''))
    return current, forwarded, is_forward


def email_parts(message) -> EmailParts:
    """Read-only transient plaintext for matching/classification, never a storage write.

    Key failures deliberately propagate: ciphertext must never become model input.
    Caller must first enforce visibility, source, worker-generation and consent gates.
    """
    if message.deleted_at is not None:
        raise ValueError('Deleted email content cannot be processed.')
    subject = (message.subject or '')[:1000]
    body = decrypt_content(message.body) if message.body else ''
    if not body:
        body = decrypt_content(message.snippet or '')
    current, forwarded, is_forward = _split(body[:100_000], subject)
    return EmailParts(subject, current, forwarded, is_forward)


def classification_text(message):
    """(subject, current text): the sender's own new text, without quoted or forwarded history."""
    parts = email_parts(message)
    return parts.subject, parts.current


def ai_input(parts: EmailParts) -> str:
    """The body sent to the classifier: current text, plus forwarded history clearly labelled as such."""
    if not parts.is_forward or not parts.forwarded:
        return parts.current
    return (parts.current + '\n\n[Forwarded message: earlier history, not a new decision]\n' + parts.forwarded).strip()


def has_too_little_text(parts: EmailParts) -> bool:
    return not parts.is_forward and len(parts.current.strip()) < MIN_CURRENT_TEXT
