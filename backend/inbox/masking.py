"""Mask personal data in email text before it is sent to the classifier provider.

Three layers, each returning character spans on the same text; every span becomes "[redacted]".
1. Known values: the candidate's name parts (whole word, any case), their email/phone/profile URL, the connected
   mailbox address, the sender's address, a person-like sender display name and first.last names in addresses.
2. Patterns and validators: today's redaction (safe_text.PATTERNS) plus street addresses, state + ZIP, IPv4,
   labelled IDs and credentials, PAN, Aadhaar (Verhoeff), phone numbers (libphonenumber, IN/US/GB) and bank
   details (9-18 digit numbers, grouped digits, IFSC, UPI ids, labelled account numbers).
3. Presidio: every entity type except DATE_TIME at score 0.4, with wider bank/phone context and recognizers for
   ABA routing numbers and Indian account numbers, IFSC and UPI ids.

Over-masking (company names, addresses) is accepted: the classifier only needs the email's intent. The masked text
is never stored or logged. If any layer fails, the caller fails closed and nothing is sent.
"""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from email.utils import parseaddr

import phonenumbers

from backend.inbox.safe_text import PATTERNS as TODAY_PATTERNS

MASK = "[redacted]"
_LETTERS = r"[^\W\d_]"


@dataclass(frozen=True)
class KnownIdentity:
    """Values the worker already holds for this email. Transient: never stored or logged."""
    candidate_name: str = ""
    candidate_values: tuple[str, ...] = ()   # the candidate's email, phone, profile URL, the mailbox address
    sender_name: str = ""
    sender_email: str = ""


# ---------------- layer 1: known values ----------------

# Words before the @ that are roles, not names.
ROLE_WORDS = {
    'info', 'contact', 'contactus', 'support', 'help', 'helpdesk', 'noreply', 'no', 'reply', 'donotreply', 'do', 'not',
    'careers', 'career', 'jobs', 'job', 'hr', 'team', 'talent', 'recruiting', 'recruiter', 'recruitment', 'hiring',
    'admin', 'hello', 'notifications', 'notification', 'notify', 'mail', 'email', 'news', 'newsletter', 'marketing',
    'sales', 'service', 'services', 'account', 'accounts', 'billing', 'security', 'alerts', 'alert', 'updates',
    'system', 'invitations', 'invite', 'calendar', 'applications', 'application', 'apply', 'candidates',
    'candidate', 'the', 'and', 'office', 'people', 'staffing', 'onboarding', 'payroll', 'feedback', 'survey',
    'mailer', 'daemon', 'postmaster', 'bounce', 'reports', 'digest', 'messages', 'message', 'inbox', 'customer'}
# Words that mark a display name as a team or company, not a person.
ORG_WORDS = {
    'team', 'teams', 'careers', 'career', 'jobs', 'job', 'talent', 'recruiting', 'recruitment', 'recruiter', 'hiring',
    'hr', 'notifications', 'notification', 'inc', 'llc', 'ltd', 'corp', 'corporation', 'group', 'the', 'support',
    'service', 'services', 'solutions', 'systems', 'technologies', 'technology', 'consulting', 'staffing',
    'partners', 'global', 'international', 'university', 'college', 'bank', 'health', 'healthcare', 'company',
    'labs', 'digital', 'software', 'network', 'networks', 'alerts', 'alert', 'news', 'newsletter', 'portal',
    'people', 'acquisition', 'admin', 'noreply', 'no-reply', 'info', 'mail', 'office', 'department', 'center',
    'centre', 'resources', 'human', 'airlines', 'insurance', 'financial', 'capital', 'media', 'agency', 'and', '&'}
EMAIL_RE = re.compile(r'\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b', re.I)


def _name_parts(name: str) -> set[str]:
    return {part.lower() for part in re.findall(_LETTERS + r"{3,}", name or "")}


def _word_spans(text: str, words: set[str], *, any_case: bool) -> list[tuple[int, int]]:
    if not words:
        return []
    if any_case:
        alternatives, flags = "|".join(map(re.escape, sorted(words))), re.I
    else:  # capitalised or upper case only, so a name that is also a word ("will", "grant") stays in lower case
        alternatives = "|".join(re.escape(form) for w in sorted(words) for form in (w.capitalize(), w.upper()))
        flags = 0
    pattern = re.compile(rf"(?<!{_LETTERS})(?:{alternatives})(?!{_LETTERS})", flags)
    return [(m.start(), m.end()) for m in pattern.finditer(text)]


def _address_names(text: str, known: KnownIdentity, candidate: set[str]) -> set[str]:
    """Name parts from first.last-style addresses in the text and the sender's address."""
    names = set()
    for address in [m.group(0) for m in EMAIL_RE.finditer(text)] + [known.sender_email]:
        local = address.split('@')[0]
        parts = [p for p in re.split(r'[._-]+', re.sub(r'\d+', '', local)) if p]
        if len(parts) >= 2 and all(len(p) >= 2 and p.isalpha() and p.lower() not in ROLE_WORDS for p in parts):
            names |= {p.lower() for p in parts if len(p) >= 3 and p.lower() not in candidate}
    return names


def _sender_names(known: KnownIdentity, candidate: set[str]) -> set[str]:
    """A person-like display name ("Jane Doe"), unless it is the company in the sender's domain."""
    name = re.split(r'\s+(?:via|at|from)\s+|\s*[|(\[,]\s*', (known.sender_name or '').strip().strip('"\''), maxsplit=1)[0]
    words = name.strip().split()
    if not 2 <= len(words) <= 3 or not all(re.fullmatch(r"[A-Z][a-z]+(?:['-][A-Za-z]+)?", w) for w in words):
        return set()
    if any(w.lower() in ORG_WORDS for w in words):
        return set()
    domain = re.sub(r'[^a-z]', '', (known.sender_email or '').lower().split('@')[-1])
    if ''.join(words).lower() in domain or any(len(w) >= 4 and w.lower() in domain for w in words):
        return set()
    return {w.lower() for w in words if len(w) >= 3 and w.lower() not in candidate}


def layer1(text: str, known: KnownIdentity) -> list[tuple[int, int]]:
    candidate = _name_parts(known.candidate_name)
    spans = _word_spans(text, candidate, any_case=True)
    spans += _word_spans(text, _address_names(text, known, candidate) | _sender_names(known, candidate), any_case=False)
    for value in {v.strip() for v in (*known.candidate_values, parseaddr(known.sender_email)[1]) if v and v.strip()}:
        spans += [(m.start(), m.end()) for m in re.finditer(re.escape(value), text, re.I)]
    return spans


# ---------------- layer 2: patterns and validators ----------------

_US_STATES = (
    'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|'
    'Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|'
    'Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|'
    'Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|'
    'West Virginia|Wisconsin|Wyoming')
LAYER2_PATTERNS = [p for p, _ in TODAY_PATTERNS] + [
    re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.I),                                     # email
    re.compile(r'(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])'),  # IPv4
    re.compile(r'\b\d{1,6}\s+(?:[A-Z][A-Za-z]*\.?\s+){1,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|'
               r'Lane|Way|Pkwy|Parkway|Ct|Court|Pl|Place|Hwy|Highway|Cir|Circle|Ter|Terrace|Plaza|Sq|Square)\b\.?'
               r'(?:,?\s*(?:Suite|Ste|Apt|Unit|Floor|Fl|#)\.?\s*[\w-]+)?'),                               # street address
    re.compile(rf'\b(?:[A-Z]{{2}}|{_US_STATES}),?\s+\d{{5}}(?:-\d{{4}})?\b'),                             # state + ZIP
    re.compile(r'(?i)\b(?:candidate|applicant|application|reference|ref|req(?:uisition)?|employee|confirmation)\s*'
               r'(?:id|#|no\.?|number)\s*[:#]?\s*[A-Z0-9-]{4,}'),                                         # labelled IDs
    re.compile(r'(?i)\b(?:user\s?name|user\s?id|login(?:\s?id)?)[ \t]*[:=][ \t]*(?!\[)\S+'),             # login
    re.compile(r'(?i)\b(?:password|passwd|passcode|pin|otp|access token|api key|client secret|secret key)'
               r'[ \t]*[:=][ \t]*(?!\[)\S+'),                                                             # credential
    re.compile(r'\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b'),                                             # PAN
    # bank details
    re.compile(r'(?<![\w.])\d{9,18}(?![\w]|[.,]\d)'),                                                   # 9-18 digits
    re.compile(r'(?<![\w.])(?:\d{4}[ -]){2,3}\d{1,6}(?![\w]|[.,]\d)'),                                  # grouped digits
    re.compile(r'\b[A-Z]{4}0[A-Z0-9]{6}\b'),                                                            # IFSC
    re.compile(r'(?<![\w.%+-])[\w.-]{2,256}@[A-Za-z]{2,64}(?![\w.@-])'),                                # UPI id
    re.compile(r'(?i)\b(?:a/?c|acct|account|acc)\.?\s*(?:no\.?|number|#)?\s*[:#-]?\s*\d{6,18}\b'),     # labelled a/c
]
_AADHAAR = re.compile(r'(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)')
_VD = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
       [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
       [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
       [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_VP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
       [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
       [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]


def _verhoeff_ok(digits: str) -> bool:
    check = 0
    for i, digit in enumerate(reversed(digits)):
        check = _VD[check][_VP[i % 8][int(digit)]]
    return check == 0


def layer2(text: str) -> list[tuple[int, int]]:
    spans = [(m.start(), m.end()) for p in LAYER2_PATTERNS for m in p.finditer(text)]
    for region in ('IN', 'US', 'GB'):
        spans += [(m.start, m.end) for m in
                  phonenumbers.PhoneNumberMatcher(text, region, leniency=phonenumbers.Leniency.VALID)]
    spans += [(m.start(), m.end()) for m in _AADHAAR.finditer(text) if _verhoeff_ok(re.sub(r'\D', '', m.group(0)))]
    return spans


# ---------------- layer 3: Presidio ----------------

BANK_CONTEXT = ['account', 'acct', 'bank', 'banking', 'savings', 'checking', 'deposit', 'beneficiary', 'salary',
                'credit', 'debit', 'transfer', 'remit', 'neft', 'imps', 'rtgs', 'ifsc', 'micr', 'branch', 'payee',
                'wire', 'routing']
PHONE_CONTEXT = ['phone', 'number', 'telephone', 'tel', 'cell', 'cellphone', 'mobile', 'call', 'whatsapp', 'contact',
                 'reach', 'landline', 'office', 'direct', 'fax']
PHONE_REGIONS = ('IN', 'US', 'GB', 'CA', 'AE', 'SG', 'AU', 'DE', 'FR', 'IL', 'BR')
_engine = None
_entities: list[str] = []
_lock = threading.Lock()


def _presidio():
    """One analyzer per process, built on first use (about 6 s and 650 MB with en_core_web_lg)."""
    global _engine, _entities
    with _lock:
        if _engine is None:
            from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
            from presidio_analyzer.predefined_recognizers import (AbaRoutingRecognizer, PhoneRecognizer,
                                                                  UsBankRecognizer)
            engine = AnalyzerEngine()
            # Its email check looks domains up through tldextract, which downloads a suffix list. Emails are
            # masked by layers 1 and 2, so the recognizer goes and nothing here reaches the network.
            engine.registry.remove_recognizer('EmailRecognizer')
            engine.registry.remove_recognizer('UsBankRecognizer')
            engine.registry.add_recognizer(UsBankRecognizer(context=BANK_CONTEXT))
            engine.registry.remove_recognizer('PhoneRecognizer')
            engine.registry.add_recognizer(PhoneRecognizer(context=PHONE_CONTEXT, supported_regions=PHONE_REGIONS))
            engine.registry.add_recognizer(AbaRoutingRecognizer())
            engine.registry.add_recognizer(PatternRecognizer(
                supported_entity='IN_BANK_ACCOUNT', name='InBankAccountRecognizer',
                patterns=[Pattern('IN bank account', r'\b\d{9,18}\b', 0.3)], context=BANK_CONTEXT))
            engine.registry.add_recognizer(PatternRecognizer(
                supported_entity='IN_IFSC', name='InIfscRecognizer',
                patterns=[Pattern('IFSC', r'\b[A-Z]{4}0[A-Z0-9]{6}\b', 0.85)], context=['ifsc', 'branch', 'bank']))
            engine.registry.add_recognizer(PatternRecognizer(
                supported_entity='IN_UPI_ID', name='InUpiRecognizer',
                patterns=[Pattern('UPI id', r'(?<![\w.%+-])[\w.-]{2,256}@[A-Za-z]{2,64}(?![\w.@-])', 0.6)],
                context=['upi', 'vpa', 'pay', 'gpay', 'phonepe', 'paytm', 'bhim']))
            _entities = [e for e in engine.get_supported_entities('en') if e != 'DATE_TIME']
            _engine = engine
        return _engine


def layer3(text: str) -> list[tuple[int, int]]:
    engine = _presidio()
    with _lock:  # one analysis at a time: the scheduler and the wake-up thread can both run the worker
        results = engine.analyze(text=text, language='en', entities=_entities, score_threshold=0.4)
    return [(r.start, r.end) for r in results]


# ---------------- all three ----------------

def mask_for_classifier(text: str, known: KnownIdentity | None = None) -> str:
    if not text:
        return ''
    known = known or KnownIdentity()
    merged: list[list[int]] = []
    for start, end in sorted(layer1(text, known) + layer2(text) + layer3(text)):
        if merged and start <= merged[-1][1]:   # overlapping or touching spans become one mask
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    out, last = [], 0
    for start, end in merged:
        out.append(text[last:start])
        out.append(MASK)
        last = end
    out.append(text[last:])
    return ''.join(out)
