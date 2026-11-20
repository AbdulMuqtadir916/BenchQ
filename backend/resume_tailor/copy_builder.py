"""The copy's builder for the Mads tailor: the numbered résumé the model reads, and the final draft put together
with the résumé's own facts. Copied from JobNavigator's focused_tailor_basics, focused_tailor_bullets, focused_tailor,
focused_tailor_matching and focused_v2, only the pieces this mode runs. One change: the report's requirements_met is
written as [] (JobNavigator works it out from the reply's requirements_met, which the Mads reply never has, so it is
always [] there too).
"""
import json
import re

from backend.resume_tailor import resume_bits as rs
from backend.resume_tailor.checks import _is_stated


# How much the posting wants a thing: it requires it, would like it, or lists it as part of the work.
MUST_HAVE, NICE_TO_HAVE, DUTY = "must", "nice", "duty"


# How many bullets a focused copy gives each role, most recent first: five, then four, then three for every earlier one.
BULLETS_OF_THE_LATEST_ROLES = (5, 4)


BULLETS_OF_AN_EARLIER_ROLE = 3


def _roles(base: dict) -> list:
    return [role for role in (base.get("experience") or []) if isinstance(role, dict)]


def _projects(base: dict) -> list:
    return [project for project in (base.get("projects") or []) if isinstance(project, dict)]


def _bullets_of(entry: dict) -> list:
    """A role's or project's bullets, the ones that are text."""
    return [bullet for bullet in entry.get("bullets") or [] if isinstance(bullet, str)]


def bullets_a_role_gets(role_number: int) -> int:
    """How many bullets a focused copy gives a role; role 1 is the most recent."""
    if role_number <= len(BULLETS_OF_THE_LATEST_ROLES):
        return BULLETS_OF_THE_LATEST_ROLES[role_number - 1]
    return BULLETS_OF_AN_EARLIER_ROLE


# Where the copy keeps its report; the "_" keeps it off the printed résumé.
REPORT_KEY = "_focused_report"


def resume_as_numbered_text(base: dict) -> str:
    """The base résumé as plain text, with its roles, projects and bullets numbered so the reply can point at them."""
    base = base or {}
    header = base.get("header") if isinstance(base.get("header"), dict) else {}
    lines = [f"Name: {header.get('name', '')}",
             f"Headline: {header.get('title', '')}",
             f"Contact line: {_contact_line(header)}",
             "", "SUMMARY", str(base.get("summary") or ""),
             "", "SKILLS"]
    for line_number, (label, value) in enumerate((base.get("skills") or {}).items(), start=1):
        lines.append(f"  {line_number}. {label}: {value}")
    for role_number, role in enumerate(_roles(base), start=1):
        lines += ["", f"ROLE {role_number}: {_facts_of_the_role(role)}"]
        lines += _numbered(role.get("bullets"))
    for project_number, project in enumerate(_projects(base), start=1):
        lines += ["", f"PROJECT {project_number}: {rs._text(project.get('name'))}"]
        lines += _numbered(project.get("bullets"))
    lines += ["", "EDUCATION"]
    for education in base.get("education") or []:
        if isinstance(education, dict):
            lines.append(" | ".join(rs._text(education.get(key)) for key in ("degree", "institution") if education.get(key)))
    lines += ["", "CERTIFICATIONS"]
    for certification in base.get("certifications") or []:
        lines.append(rs._text(certification))
    return "\n".join(lines)


def _contact_line(header: dict) -> str:
    items = [rs._text(item.get("text")) for item in header.get("contact_items") or [] if isinstance(item, dict)]
    return " | ".join(items)


def _facts_of_the_role(role: dict) -> str:
    """'Title | Company | Mon YYYY – Mon YYYY', leaving out what the role does not state."""
    parts = [rs._text(role.get("title")), rs._text(role.get("company")), rs._role_dates(role) or rs._text(role.get("date"))]
    return " | ".join(part for part in parts if part)


def _numbered(bullets) -> list:
    return [f"  {number}. {bullet}" for number, bullet in enumerate(bullets or [], start=1)]


def _by_number(entries, number_key: str) -> dict:
    """The reply's roles or projects by the number they point at; the first mention of a number wins."""
    found = {}
    for entry in entries or []:
        if isinstance(entry, dict) and isinstance(entry.get(number_key), int):
            found.setdefault(entry[number_key], entry)
    return found


def _education_with_its_dates(base: dict) -> list:
    education = []
    for entry in base.get("education") or []:
        if isinstance(entry, dict):
            entry = dict(entry)
            date = rs._graduation_date(entry)
            if date:
                entry["years"] = date
            education.append(entry)
    return education


def requirements_listed(reply: dict) -> list:
    """The posting's requirements as the reply listed them, [{"name", "kind"}]."""
    listed = []
    for entry in (reply or {}).get("requirements") or []:
        if isinstance(entry, dict) and rs._text(entry.get("name")) and entry.get("kind") in (MUST_HAVE, NICE_TO_HAVE, DUTY):
            listed.append({"name": rs._text(entry["name"]), "kind": entry["kind"]})
    return listed


MOST_AWARDS = 5


MOST_PROJECT_BULLETS = 3


def _resume_as_numbered_text(base: dict) -> str:
    """The focused copy's numbered résumé, plus its awards and languages when it has them."""
    lines = [resume_as_numbered_text(base)]
    awards = _awards_of(base)
    if awards:
        lines += ["", "AWARDS"] + [f"  {number}. {award}" for number, award in enumerate(awards, start=1)]
    languages = _languages_of(base)
    if languages:
        lines += ["", "LANGUAGES", ", ".join(languages)]
    return "\n".join(lines)


def assemble_v2_resume(reply: dict, base: dict, jd_text: str = "", title_of_the_job: str = "") -> dict:
    """A focused_v2 reply put together as written, for a pipeline whose reviewer checks it: no code overrules the model.

    Only the facts come from the base (each role's title, employer, location and dates, the education, the contact
    items, the certifications and awards it states); the headline, summary, skills and bullets are the reply's own.
    Formatting alone is applied: dates with a plain hyphen and at most MOST_PROJECT_BULLETS bullets a project.
    """
    reply = reply if isinstance(reply, dict) else {}
    base = base or {}
    base_text = json.dumps(base, ensure_ascii=False)
    reply_header = reply.get("header") if isinstance(reply.get("header"), dict) else {}
    pointed_at = {"location": reply_header.get("location"), "work_authorization": reply_header.get("work_authorization")}
    header = rs._tailored_header(base.get("header") if isinstance(base.get("header"), dict) else {}, pointed_at,
                                 rs._squash(base_text), rs.target_job_title(reply, jd_text, title_of_the_job))
    headline = rs._text(reply.get("headline"))[:rs.LONGEST_TARGET_TITLE_CHARS]
    if headline:
        header["target_title"], header["title"] = headline, ""

    copy = {
        "header": header,
        "summary": rs._text(reply.get("professional_summary")) or rs._text(base.get("summary")),
        "skills": rs._skills_map(reply.get("technical_skills")) or dict(base.get("skills") or {}),
        "experience": _roles_as_written(reply, base),
        "projects": _projects_as_written(reply, base),
        "education": _education_with_its_dates(base),
        "certifications": rs._certifications(reply.get("certifications"), base),
        rs.LAYOUT_KEY: rs.ATS_LAYOUT,
    }
    _dates_with_a_plain_hyphen(copy)
    awards = awards_kept(reply, base)
    if awards:
        copy["awards"] = awards
    if reply.get("posting_asks_for_a_language"):
        languages = [language for language in _languages_of(base) if _is_stated(language, jd_text)]
        if languages:
            copy["languages"] = languages
    copy[REPORT_KEY] = {
        "requirements": requirements_listed(reply),
        "requirements_met": [],          # always empty here: the Mads reply lists no requirements_met
        "closest_evidence": reply.get("closest_evidence") or [],
        "bullets": sum(len(role["bullets"]) for role in copy["experience"]),
        "bullets_in_the_original": sum(len(role.get("bullets") or []) for role in _roles(base)),
        "checked_by": "reviewer",
    }
    return copy


def _roles_as_written(reply: dict, base: dict) -> list:
    """Every role of the base with its own facts and the reply's bullets; a role the reply left out keeps its first
    bullets as the résumé wrote them, so no role is ever dropped."""
    written = _by_number(reply.get("work_experience"), "role_number")
    experience = []
    for number, role in enumerate(_roles(base), start=1):
        role = dict(role)
        role.pop("suggested_bullets", None)
        bullets = [rs._text(bullet.get("text") if isinstance(bullet, dict) else bullet)
                   for bullet in (written.get(number) or {}).get("bullets") or []]
        role["bullets"] = [bullet for bullet in bullets if bullet] or list(role.get("bullets") or [])[
            :bullets_a_role_gets(number)]
        role["description"] = ""
        dates = rs._role_dates(role)
        if dates:
            role["date"] = dates
        experience.append(role)
    return experience


def _projects_as_written(reply: dict, base: dict) -> list:
    """The projects the reply kept, with its bullets, at most MOST_PROJECT_BULLETS each."""
    written = _by_number(reply.get("projects"), "project_number")
    projects = []
    for number, project in enumerate(_projects(base), start=1):
        if number not in written:
            continue
        bullets = [rs._text(bullet.get("text") if isinstance(bullet, dict) else bullet)
                   for bullet in written[number].get("bullets") or []]
        bullets = [bullet for bullet in bullets if bullet][:MOST_PROJECT_BULLETS]
        if bullets:
            projects.append({**project, "bullets": bullets})
    return projects


_DASH = re.compile(r"\s*[–—]\s*")


def _dates_with_a_plain_hyphen(copy: dict) -> None:
    for entry in copy["experience"] + copy["projects"]:
        for key in ("date", "dates"):
            if isinstance(entry.get(key), str):
                entry[key] = _DASH.sub(" - ", entry[key])
    for entry in copy["education"]:
        if isinstance(entry.get("years"), str):
            entry["years"] = _DASH.sub(" - ", entry["years"])


def _awards_of(base: dict) -> list:
    awards = []
    for award in base.get("awards") or []:
        if isinstance(award, dict):
            award = " | ".join(rs._text(award.get(key)) for key in ("name", "title", "issuer", "date") if award.get(key))
        award = rs._text(award)
        if award:
            awards.append(award)
    return awards


def awards_kept(reply: dict, base: dict) -> list:
    """The résumé's awards the reply chose, as the résumé states them, at most MOST_AWARDS, in the résumé's order."""
    awards = _awards_of(base)
    chosen = {number for number in (reply.get("awards") or []) if isinstance(number, int) and 1 <= number <= len(awards)}
    return [award for number, award in enumerate(awards, start=1) if number in chosen][:MOST_AWARDS]


def _languages_of(base: dict) -> list:
    languages = base.get("languages") or []
    if isinstance(languages, str):
        languages = re.split(r"[,;]", languages)
    return [rs._text(language.get("name") if isinstance(language, dict) else language).strip()
            for language in languages if rs._text(language.get("name") if isinstance(language, dict) else language).strip()]
