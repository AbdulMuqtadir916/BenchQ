"""Between a stored résumé version and the tailor (docs/team/tailoring.md §4; replaces the handoff's §11).

A version is stored as columns: the header fields, the summary and its id, and sections whose items carry ids
(backend/candidates/versions.py `content_of`). The tailor reads the base résumé the parser handoff builds
(`build_base_resume`), so:

- **In:** `tailor_input(content)` writes the version back in the parse's shape (what `first_base` read it from) and
  builds the base from that. It also notes which of the version's jobs and projects the base keeps, since the base
  leaves out an entry with no bullets and the copy points at the base's.
- **Out:** `version_content(copy, content, tailor_input)` lays the tailored copy over the version: the header is the
  version's own but for the title (the copy's headline), the summary and skills are the copy's, every job keeps its
  facts with the copy's bullets and printed dates, the projects, certifications and awards are the version's own
  entries that the copy kept, and the education and languages are the version's own. An item or bullet that comes
  through unchanged carries its id, so `versions._with_ids` (the save's rule) keeps it; a changed one gets a new id
  there. A printed section the copy left out is left out (decided 2026-11-12, Q12); languages are never printed and
  autofill reads them, so they always stay (decided 2026-11-12, Zuhair).
"""
import re
from dataclasses import dataclass

from backend.analyzer.prompt_fence import without_fake_markers
from backend.candidates.base_resume import (_award_line, _clean_bullets, build_base_resume, canonicalize_tech,
                                            split_skills)
from backend.candidates.values import dicts, text
from backend.candidates.versions import HEADER

# The posting as the tailor reads it: its first 20,000 characters (the handoff's JD_MAX_CHARS).
JD_MAX_CHARS = 20_000
# A skill stored with no category is listed under this one, as the résumé's text prints it (candidates/resume_text.py).
UNNAMED_SKILLS = "Skills"
_HEAD_FIELDS = ("city", "state", "country", "email", "phone", "work_authorization", "github", "linkedin")
_ENTRY_KEYS = ("name", "issuer", "date", "detail")


def prepared_posting(description) -> str:
    """The posting's text without fake fence markers (and what a fake end marker cuts off), cut to JD_MAX_CHARS."""
    return without_fake_markers(text(description))["text"][:JD_MAX_CHARS]


@dataclass(frozen=True)
class TailorInput:
    """The base résumé the tailor reads, and for each of its jobs and projects the index of the version's own."""
    base: dict
    job_index: list
    project_index: list


def _bullet_texts(item: dict) -> list:
    return [text(b.get("text")) for b in dicts(item.get("bullets"))]


def as_parse(content: dict) -> dict:
    """The version in the shape the parser stores (resume_parses.parse), which `first_base` wrote it from."""
    skills = {}
    for skill in dicts(content.get("skills")):
        if text(skill.get("name")):
            skills.setdefault(text(skill.get("category")) or UNNAMED_SKILLS, []).append(text(skill.get("name")))
    return {
        "header": {"name": text(content.get("full_name")), "title": text(content.get("title")),
                   **{key: text(content.get(key)) for key in _HEAD_FIELDS}},
        "professional_summary": text(content.get("summary")),
        "technical_skills": [{"category": category, "skills": ", ".join(names)} for category, names in skills.items()],
        "work_experience": [{**{key: text(job.get(key)) for key in ("job_title", "company", "location", "dates", "start",
                                                                     "end")},
                             "current": bool(job.get("current")), "bullets": _bullet_texts(job)}
                            for job in dicts(content.get("experiences"))],
        "projects": [{**{key: text(p.get(key)) for key in ("name", "url", "dates", "technologies")},
                      "bullets": _bullet_texts(p)} for p in dicts(content.get("projects"))],
        "education": [{key: text(e.get(key)) for key in ("degree", "institution", "graduation_date", "grade")}
                      for e in dicts(content.get("educations"))],
        "certifications": [{key: text(c.get(key)) for key in _ENTRY_KEYS} for c in dicts(content.get("certifications"))],
        "awards": [{key: text(a.get(key)) for key in _ENTRY_KEYS} for a in dicts(content.get("awards"))],
        "languages": [text(lang.get("name")) for lang in dicts(content.get("languages")) if text(lang.get("name"))],
    }


def _with_bullets(items: list) -> list:
    """The indexes of the entries the base keeps: the ones with a bullet left after clean-up (build_base_resume)."""
    return [index for index, item in enumerate(items) if _clean_bullets(_bullet_texts(item))]


def tailor_input(content: dict) -> TailorInput:
    """What the tailor reads for a version (`versions.content_of`)."""
    return TailorInput(base=build_base_resume(as_parse(content)),
                       job_index=_with_bullets(dicts(content.get("experiences"))),
                       project_index=_with_bullets(dicts(content.get("projects"))))


# ── The copy back into a version ─────────────────────────────────────────────────────────────────────────────────────

def _bullets(texts: list, stored: list) -> list:
    """The copy's bullets; one written exactly as a stored bullet carries that bullet's id (each id once)."""
    free = {}
    for bullet in dicts(stored):
        free.setdefault(text(bullet.get("text")), []).append(bullet.get("id"))
    out = []
    for bullet in texts:
        ids = free.get(bullet) or []
        out.append({"id": ids.pop(0), "text": bullet} if ids else {"text": bullet})
    return out


def _kept_entries(chosen: list, entries: list, lines) -> list:
    """The stored entries the copy kept, in the copy's order: each chosen line matched once to the entry it prints
    (`lines(entry)` gives the ways an entry is printed). A line no entry prints is left out."""
    kept, used = [], set()
    for line in chosen:
        key = _identity(line)
        if len(key) < 3:
            continue
        exact = [i for i, entry in enumerate(entries) if i not in used and key in {_identity(x) for x in lines(entry)}]
        within = [i for i, entry in enumerate(entries) if i not in used and any(key in _identity(x) for x in lines(entry))]
        found = (exact or within or [None])[0]
        if found is not None:
            used.add(found)
            kept.append(entries[found])
    return kept


def _identity(value) -> str:
    """What a printed name, line or date is compared by: its letters and digits in any case, and the symbols that tell
    names apart ("C++ Tracker" is not "C# Tracker"); dashes, spaces and other punctuation don't count ("2021 – 2022"
    is "2021 - 2022"). Abdul's review of the tailoring PR, 2026-11-12: comparing letters and digits only made C++
    and C# the same, and saved one project under the other's name."""
    return re.sub(r"[^a-z0-9+#]", "", str(value or "").lower())


def _facts(entry: dict) -> dict:
    """An entry's fields but its bullets, compared as `_identity`: the copy prints "2021 - 2022" where the version
    says "2021 – 2022", and that is the same project."""
    return {key: _identity(value) for key, value in entry.items() if key != "bullets"}


def _projects(copy: dict, content: dict, given: TailorInput) -> list:
    """The version's projects the copy kept, with the copy's bullets. The copy's project is the base's own with new
    bullets, in the base's order, so it is found by its other fields (compared as `_facts`). Its printed fields stay
    the version's own."""
    stored, base_projects = dicts(content.get("projects")), dicts(given.base.get("projects"))
    out, start = [], 0
    for project in dicts(copy.get("projects")):
        facts = _facts(project)
        for number in range(start, len(base_projects)):
            if _facts(base_projects[number]) == facts:
                item = stored[given.project_index[number]]
                out.append({**item, "bullets": _bullets(list(project.get("bullets") or []), item.get("bullets"))})
                start = number + 1
                break
    return out


def _skills(copy: dict, content: dict) -> list:
    """The copy's competencies as the version's skills: each label a category, each name in its line a skill. A skill
    stored with the same category and name carries its id."""
    free = {}
    for skill in dicts(content.get("skills")):
        free.setdefault((text(skill.get("category")), text(skill.get("name"))), []).append(skill.get("id"))
    out = []
    for category, line in (copy.get("skills") or {}).items():
        for name in split_skills(line):
            ids = free.get((category, name)) or []
            out.append({**({"id": ids.pop(0)} if ids else {}), "category": category, "name": name})
    return out


def _printed_dates(copied: str, stored: str) -> str:
    """The copy's printed dates, unless they are the version's own written another way (the copy writes "-" where the
    version has "–"): then the version's, as the BDE wrote them (Abdul's review, 2026-11-12)."""
    if not copied or _identity(copied) == _identity(stored):
        return stored
    return copied


def version_content(copy: dict, content: dict, given: TailorInput) -> dict:
    """The tailored copy as a version's content, ready for `versions._with_ids(content, ...)`."""
    head = copy.get("header") or {}
    jobs = dicts(content.get("experiences"))
    tailored = dict(zip(given.job_index, dicts(copy.get("experience"))))
    experiences = []
    for index, job in enumerate(jobs):
        role = tailored.get(index)
        if role is None:            # an entry with no bullets never reached the tailor: it stays as stored
            experiences.append(job)
            continue
        experiences.append({**job, "dates": _printed_dates(text(role.get("date")), text(job.get("dates"))),
                            "bullets": _bullets(list(role.get("bullets") or []), job.get("bullets"))})
    certifications = dicts(content.get("certifications"))
    awards = dicts(content.get("awards"))
    return {
        **{key: content.get(key) for key in HEADER},
        "title": text(head.get("target_title")) or text(head.get("title")) or content.get("title"),
        "summary": text(copy.get("summary")) or None,
        "summary_id": content.get("summary_id"),
        "skills": _skills(copy, content),
        "experiences": experiences,
        "projects": _projects(copy, content, given),
        "educations": dicts(content.get("educations")),
        "certifications": _kept_entries(list(copy.get("certifications") or []), certifications,
                                        lambda c: (canonicalize_tech(_award_line(c)), canonicalize_tech(text(c.get("name"))))),
        "awards": _kept_entries(list(copy.get("awards") or []), awards, lambda a: (_award_line(a),)),
        # The version's own, whatever the copy kept: languages are never printed, and autofill answers "which
        # languages" from the version (decided 2026-11-12, Zuhair).
        "languages": dicts(content.get("languages")),
    }
