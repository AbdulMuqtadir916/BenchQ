"""The résumé helpers the tailor uses: the pieces of JobNavigator's backend/analyzer/resume_schema.py the handoff names
(Part 2 §9). Where BenchQ's parser port (backend/candidates/base_resume.py) already has the same function, its copy is
used; it is the same code, checked function by function on 2026-11-12. The pieces below were missing and are copied as
they are."""
import re

from backend.candidates.base_resume import (  # noqa: F401  (re-exported for the tailor's modules as rs.<name>)
    ATS_LAYOUT, LAYOUT_KEY, _CLAIM_RES, _DETAIL_GROUP_RE, _EMAIL_RE, _PHONE_RE, _month_year, _role_dates, _skills_map,
    _squash, _text, canonicalize_tech, split_skills as _split_skills,
)


# The posting's own job title, which a tailored copy prints apart from the candidate's headline.
TARGET_JOB_TITLE = "target_job_title"


_HEADER_ORDER = ("location", "email", "phone", "work_authorization", "github", "linkedin")


def _strings(node):
    """Every string value in a nested json_data node (keys excluded)."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from _strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from _strings(value)


def _graduation_date(edu: dict) -> str:
    """When an education entry ended, 'Mon YYYY' where the month is known; '' while it is ongoing or undated."""
    if edu.get("current"):
        return ""
    return _month_year(edu.get("end"))


def _contact_kind(item: dict) -> str | None:
    """The header field a printed contact item is, or None for one the header leaves out (city, portfolio, …)."""
    text, url = str(item.get("text") or ""), str(item.get("url") or "")
    both = f"{text} {url}".lower()
    if "linkedin" in both:
        return "linkedin"
    if "github" in both:
        return "github"
    if url.lower().startswith("mailto:") or _EMAIL_RE.search(text):
        return "email"
    if url.lower().startswith("tel:") or _PHONE_RE.search(text):
        return "phone"
    return None


LONGEST_TARGET_TITLE_CHARS = 120


def target_job_title(reply: dict, jd_text: str, title_of_the_job: str = "") -> str:
    """The posting's job title, word for word: the stored job's own, else the reply's when the posting states it.

    It names the role applied for, so it is checked against the posting and never against the résumé.
    """
    stored = _text(title_of_the_job)
    if stored:
        return stored[:LONGEST_TARGET_TITLE_CHARS]
    from_reply = _text((reply or {}).get(TARGET_JOB_TITLE))
    key = _squash(from_reply)
    if len(key) < 3 or len(from_reply) > LONGEST_TARGET_TITLE_CHARS or key not in _squash(jd_text):
        return ""
    if key in _HEADINGS_THAT_ARE_NOT_A_JOB:
        return ""
    return from_reply


# The headings a pasted posting starts with. A reply that offers one of these as the job's title has read
# the page's layout, not the job: a copy printed "Summary" under the candidate's name on 2026-10-14.
_HEADINGS_THAT_ARE_NOT_A_JOB = {_squash(heading) for heading in (
    "Summary", "Job Summary", "Job Description", "Description", "About the job", "About the Role", "About the Company",
    "About Us", "Overview", "Role Overview", "Position Overview", "Responsibilities", "Key Responsibilities",
    "Requirements", "Qualifications", "Job Details", "Details", "Role", "Position", "Job", "Opening")}


def _tailored_header(base_header: dict, reply_header: dict, base_text: str, target_title: str = "") -> dict:
    """The name, then location, email, phone, work authorization, GitHub and LinkedIn: the base's own contact items, in that order.

    Items are copied whole (text, url, tracer stub), never rewritten from the reply.
    Location and work authorization are the two fields a parse never splits out of a
    contact line, so the reply points at each and the item printing it is kept; a value
    the base prints elsewhere (say, in the summary) becomes a plain item. Every other
    item is left out.
    """
    items = [i for i in (base_header.get("contact_items") or []) if isinstance(i, dict)]
    contact = base_header.get("contact") if isinstance(base_header.get("contact"), dict) else {}
    picked = {}
    for item in items:
        kind = _contact_kind(item)
        if kind and kind not in picked:
            picked[kind] = dict(item)

    # A field the parse split out of the header but the contact line never printed.
    for kind in ("location", "email", "phone", "github", "linkedin"):
        value = str(contact.get(kind) or "").strip()
        if value and kind not in picked:
            url = {"email": f"mailto:{value}", "github": value, "linkedin": value}.get(kind, "")
            picked[kind] = {"text": value, "url": url}

    # Neither of these has a shape a parse can recognise on its own, so the reply names
    # the value and the base's own item printing it is kept — the reply never writes one.
    for kind in ("location", "work_authorization"):
        if kind in picked:
            continue
        value = _text((reply_header or {}).get(kind))
        key = _squash(value)
        if len(key) < 3:
            continue
        for item in items:
            if _contact_kind(item) is None and key in _squash(item.get("text")):
                picked[kind] = dict(item)
                break
        else:
            if len(key) >= 5 and key in base_text:
                picked[kind] = {"text": value, "url": ""}

    # The headline may be narrowed to the part of the base's own that fits the posting
    # ("GenAI / LLM Engineer | Python Backend Engineer" -> "GenAI / LLM Engineer"), but a
    # title the base never states — a seniority, the posting's own job title — is refused.
    base_title = str(base_header.get("title") or "").strip()
    reply_title = _text((reply_header or {}).get("title"))
    title = reply_title if reply_title and _squash(reply_title) in _squash(base_title) else base_title

    header = {"name": base_header.get("name", ""),
              "title": title,
              "contact_items": [picked[k] for k in _HEADER_ORDER if k in picked]}
    # The posting's title sits in its own field, so the candidate's headline is never overwritten by it.
    if target_title:
        header["target_title"] = target_title
    if contact:
        header["contact"] = dict(contact)
    return header


def _initials(text: str) -> str:
    """'Azure Data Factory' → 'adf'; '' when there is nothing to initial."""
    words = re.findall(r"[A-Za-z0-9]+", str(text or ""))
    return "".join(w[0] for w in words).lower() if len(words) > 1 else ""


def _certifications(reply_certs, base: dict) -> list:
    """The reply's certifications that the base itself states, deduplicated, in the reply's order.

    Checked against where a base can state one (its own list, a skills category named
    for them, a line that mentions a certification) rather than the whole résumé, so a
    skill can't come back relabelled as a credential.
    """
    sources = list(_strings(base.get("certifications")))
    skills = base.get("skills")
    if isinstance(skills, dict):
        sources += [s for label, value in skills.items() if "certif" in str(label).lower()
                    for s in _strings(value)]
    sources += [s for s in _strings(base) if "certif" in s.lower()]
    pool = _squash(" ".join(sources))
    out, seen = [], set()
    for cert in reply_certs if isinstance(reply_certs, list) else []:
        text = canonicalize_tech(_text(cert))
        key = _squash(text)
        if len(key) >= 3 and key in pool and key not in seen:
            seen.add(key)
            out.append(text)
    return out


def _resume_vocabulary(base: dict) -> set:
    """Every technology name THIS résumé uses, taken from its own skills section.

    Nothing about technology is written down here. A résumé that lists PyTorch and YOLO
    gets those; one that lists GKE and Terraform gets those. The set is only ever used to
    decide which words in a bullet are worth policing, so a résumé the code has never
    seen carries its own vocabulary in with it.
    """
    vocab = set()
    for value in (base.get("skills") or {}).values():
        for term in _split_skills(str(value or "")):
            bare = _DETAIL_GROUP_RE.sub("", term).strip()
            for piece in (term, bare):
                key = _squash(piece)
                if len(key) >= 2:
                    vocab.add(key)
                # the résumé's bullets may use the acronym where its skills spell the name
                # out ("ADF" for "Azure Data Factory"), so the short form counts too
                short = _squash(_initials(piece))
                if len(short) >= 2:
                    vocab.add(short)
            # a group like "GCP (GKE, Compute Engine)" also contributes its members
            inner = re.search(r"\(([^()]*)\)\s*$", term)
            if inner:
                for member in inner.group(1).split(","):
                    key = _squash(member)
                    if len(key) >= 2:
                        vocab.add(key)
    return vocab


def _named_tech(text: str, vocab: set) -> set:
    """The vocabulary terms this sentence names, as written, matched on whole words."""
    words = re.findall(r"[A-Za-z0-9+#./-]+", str(text or ""))
    found = set()
    for n in (3, 2, 1):                       # longest phrase first: "AWS Secrets Manager"
        for i in range(len(words) - n + 1):
            phrase = " ".join(words[i:i + n])
            if _squash(phrase) in vocab:
                found.add(phrase)
    return found
