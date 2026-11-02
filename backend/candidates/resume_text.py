"""A résumé version as plain text (docs/team/resume-versioning.md §4.8; PR 6): what job scoring and interview prep give
the model. Read straight from the version's columns, in the layout JobNavigator's flattener used (`## Section`
headings, "Title at Company (dates) — Location", "- bullet"), so the prompts read the same. Empty sections are left
out; languages are never printed (§3.4)."""


def _t(value) -> str:
    return str(value or "").strip()


def _join(*bits, sep=", ") -> str:
    return sep.join(b for b in (_t(x) for x in bits) if b)


def _bullets(item: dict) -> list[str]:
    return [f"- {_t(b.get('text'))}" for b in item.get("bullets") or [] if isinstance(b, dict) and _t(b.get("text"))]


def resume_text(row) -> str:
    """`row` is a `resumes` version (or anything with its columns)."""
    parts = [_t(row.full_name), _t(row.title)]
    location = _join(row.city, row.state, row.country)
    parts.append(_join(row.email, row.phone, row.linkedin, row.github, location, sep=" | "))

    if _t(row.summary):
        parts += ["## Summary", _t(row.summary)]

    experiences = [e for e in row.experiences or [] if isinstance(e, dict)]
    if experiences:
        parts.append("## Experience")
        for exp in experiences:
            head = " at ".join(x for x in (_t(exp.get("job_title")), _t(exp.get("company"))) if x)
            dates = _t(exp.get("dates"))
            line = f"{head} ({dates})" if head and dates else head or dates
            location = _t(exp.get("location"))
            parts.append(f"{line} — {location}" if line and location else line or location)
            parts += _bullets(exp)

    groups: dict[str, list[str]] = {}
    for skill in row.skills or []:
        if isinstance(skill, dict) and _t(skill.get("name")):
            groups.setdefault(_t(skill.get("category")) or "Skills", []).append(_t(skill.get("name")))
    if groups:
        parts.append("## Skills")
        parts += [f"{category}: {', '.join(names)}" for category, names in groups.items()]

    educations = [e for e in row.educations or [] if isinstance(e, dict)]
    if educations:
        parts.append("## Education")
        for edu in educations:
            where = _join(edu.get("institution"), edu.get("graduation_date"), edu.get("grade"))
            parts.append(f"{_t(edu.get('degree'))} — {where}".strip(" —"))

    projects = [p for p in row.projects or [] if isinstance(p, dict)]
    if projects:
        parts.append("## Projects")
        for proj in projects:
            detail = _join(proj.get("technologies"), proj.get("dates"))
            parts.append(f"{_t(proj.get('name'))}: {detail}".strip(": "))
            parts += _bullets(proj)

    for heading, key in (("## Certifications", "certifications"), ("## Awards", "awards")):
        entries = [e for e in getattr(row, key) or [] if isinstance(e, dict) and _t(e.get("name"))]
        if entries:
            parts.append(heading)
            for entry in entries:
                line = _join(entry.get("name"), entry.get("issuer"), entry.get("date"), sep=" — ")
                parts.append(f"{line}: {_t(entry.get('detail'))}" if _t(entry.get("detail")) else line)

    return "\n".join(p for p in parts if p)
