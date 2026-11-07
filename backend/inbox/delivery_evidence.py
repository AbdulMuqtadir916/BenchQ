"""Conservative delivery evidence. No raw headers leave this function or reach storage.

Only a single Gmail mx.google.com Authentication-Results following a Google MX
Received boundary is considered. Duplicate/conflicting/forwarded evidence stays
UNKNOWN. Header parsing is not a substitute for rollout validation of the Gmail
trust boundary; automation remains disabled in PR 3.
"""
import re
from email.utils import getaddresses


def _domain(value):
    value = value.strip().strip('"').rstrip('.').lower()
    if '@' in value:
        value = value.rsplit('@', 1)[-1]
    try:
        return value.encode('idna').decode('ascii')
    except UnicodeError:
        return ''


_GMAIL_ARC = re.compile(r'^\s*i=\d+\s*;\s*mx\.google\.com\s*;', re.I)


def _only_gmail_arc(names):
    """Gmail seals ordinary incoming mail with its own ARC set (authserv mx.google.com, DEBUG D-26). Only an ARC
    result written by any other server means the message passed through a forwarder: that stays UNKNOWN."""
    return all(_GMAIL_ARC.match(value) for key, value in names if key == 'arc-authentication-results')


def sender_authentication(payload):
    headers = payload.get('headers') or []
    if not isinstance(headers, list) or len(headers) > 200:
        return 'UNKNOWN'
    if sum(len(str(h.get('value', ''))) for h in headers if isinstance(h, dict)) > 64000:
        return 'UNKNOWN'
    names = [(str(h.get('name', '')).lower(), str(h.get('value', ''))) for h in headers if isinstance(h, dict)]
    froms = [value for key, value in names if key == 'from']
    if len(froms) != 1:
        return 'UNKNOWN'
    addresses = getaddresses(froms)
    if len(addresses) != 1 or '@' not in addresses[0][1]:
        return 'UNKNOWN'
    domain = _domain(addresses[0][1])
    # Exact alignment is conservative: no guessed organizational/public suffix mapping.
    auth = [(i, value) for i, (key, value) in enumerate(names)
            if key == 'authentication-results' and re.match(r'^\s*mx\.google\.com\s*;', value, re.I)]
    if len(auth) != 1 or not _only_gmail_arc(names):
        return 'UNKNOWN'
    index, value = auth[0]
    if not any(key == 'received' and re.search(r'\bby\s+mx\.google\.com\b', header, re.I)
               for key, header in names[:index]):
        return 'UNKNOWN'
    clauses = re.sub(r'\([^()]*\)', ' ', value).split(';')[1:]
    parsed = {}
    for clause in clauses:
        match = re.match(r'\s*(dmarc|dkim|spf)\s*=\s*([a-z]+)\b', clause, re.I)
        if not match:
            continue
        method, verdict = (part.lower() for part in match.groups())
        if method in parsed:
            return 'UNKNOWN'
        fields = dict(re.findall(r'\b(header\.from|header\.d|header\.i|smtp\.mailfrom)\s*=\s*([^\s;]+)', clause, re.I))
        parsed[method] = verdict, {key.lower(): _domain(item) for key, item in fields.items()}
    dmarc, fields = parsed.get('dmarc', ('unknown', {}))
    if dmarc == 'pass' and fields.get('header.from') == domain:
        return 'PASS'
    spf, sf = parsed.get('spf', ('unknown', {}))
    dkim, dk = parsed.get('dkim', ('unknown', {}))
    if spf == dkim == 'pass' and sf.get('smtp.mailfrom') == domain and (dk.get('header.d') or dk.get('header.i')) == domain:
        return 'PASS'
    return 'FAIL' if any(v[0] in {'fail', 'softfail', 'permerror', 'temperror'} for v in parsed.values()) else 'UNKNOWN'
