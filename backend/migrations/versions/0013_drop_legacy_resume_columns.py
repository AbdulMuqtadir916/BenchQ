"""Résumé versioning PR 6: old résumé rows converted or deleted, the approved drops, every résumé on a base
(docs/team/resume-versioning.md §3.3; decided 2026-11-02)

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-02 18:00:00.000000

Old rows (no `base_resume_id`, JobNavigator's `json_data`):
- **No candidate** (JobNavigator's seeded "Sample PM", firm-level résumés): deleted. A base needs a candidate.
- **A candidate's base** (`is_base`): split into the content columns (new item ids, a `summary_id`) and given a base of its own:
  `UPLOAD` with its upload when it names one nobody else's base uses, else `PROMOTED`; active when the candidate has
  none.
- **A candidate's tailored résumé with a job:** split the same way and made `TAILORED` on that candidate's base
  (the converted one, else their active one), numbered by age per job. With no base to put it on, deleted.
- **A copy with no job:** deleted (Zuhair: "leave those out").

Then the approved drops: `resumes.is_base`, `parent_id`, `json_data`, `resume_parse_id`, `updated_at`,
`resume_parses.updated_at`, the index `uq_resumes_one_base_per_candidate`. `base_resume_id` and `candidate_id`
become `NOT NULL`, so the "rows with a base only" exceptions of 0008 go.

The downgrade brings the columns back and rebuilds `json_data` in JobNavigator's shape from the columns; rows the
upgrade deleted don't come back.
"""
import json
import re
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None

_ONE_BASE = 'is_base AND candidate_id IS NOT NULL AND base_resume_id IS NULL'   # 0008's narrowed form
_CATEGORY_JOB = "(category = 'BASE' AND job_id IS NULL) OR (category = 'TAILORED' AND job_id IS NOT NULL)"
_CATEGORY_JOB_OLD = f"base_resume_id IS NULL OR {_CATEGORY_JOB}"


# ── JobNavigator's json_data → the content columns (only for this migration; nothing else reads json_data) ────────

def _id() -> str:
    return str(uuid.uuid4())


def _t(value) -> str:
    return str(value or "").strip()


def _split(value) -> list:
    """A skills line into its items, ignoring commas inside brackets (as base_resume._split_skills)."""
    if isinstance(value, list):
        return [_t(v) for v in value if _t(v)]
    items, depth, current = [], 0, []
    for ch in str(value or ""):
        depth += ch in "([{"
        depth -= ch in ")]}" and depth > 0
        if ch == "," and depth == 0:
            items.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    items.append("".join(current).strip())
    return [i for i in items if i]


def _contact(header: dict) -> dict:
    out = {"email": _t(header.get("email")), "phone": _t(header.get("phone")), "linkedin": _t(header.get("linkedin")),
           "github": _t(header.get("github")), "location": _t(header.get("location"))}
    for item in header.get("contact_items") or []:
        text, url = (_t(item.get("text")), _t(item.get("url"))) if isinstance(item, dict) else (_t(item), "")
        both = f"{text} {url}".lower()
        if "@" in text or url.startswith("mailto:"):
            out["email"] = out["email"] or text or url.removeprefix("mailto:")
        elif "linkedin" in both:
            out["linkedin"] = out["linkedin"] or url or text
        elif "github" in both:
            out["github"] = out["github"] or url or text
        elif re.fullmatch(r"\+?[\d\s().-]{7,}", text):
            out["phone"] = out["phone"] or text
        elif text and not url:
            out["location"] = out["location"] or text
    return out


def _bullets(item: dict) -> list:
    texts = [_t(item.get("description"))] + [_t(b) for b in item.get("bullets") or [] if not isinstance(b, dict)]
    return [{"id": _id(), "text": t} for t in texts if t]


def columns_from_json(data: dict) -> dict:
    data = data if isinstance(data, dict) else {}
    header = data.get("header") if isinstance(data.get("header"), dict) else {}
    contact = _contact(header)
    city, _, state = contact["location"].partition(",")
    skills = data.get("skills") or {}
    pairs = skills.items() if isinstance(skills, dict) else [("", skills)]
    entries = lambda key: [{"id": _id(), "name": _t(e.get("name") if isinstance(e, dict) else e),
                            "issuer": _t(e.get("issuer")) if isinstance(e, dict) else "",
                            "date": _t(e.get("date")) if isinstance(e, dict) else "",
                            "detail": _t(e.get("detail") or e.get("description")) if isinstance(e, dict) else ""}
                           for e in data.get(key) or [] if _t(e.get("name") if isinstance(e, dict) else e)]
    dicts = lambda key: [e for e in data.get(key) or [] if isinstance(e, dict)]
    return {
        "full_name": _t(header.get("name")) or None, "title": _t(header.get("title")) or None,
        "city": city.strip() or None, "state": state.strip() or None, "country": None,
        "email": contact["email"] or None, "phone": contact["phone"] or None,
        "linkedin": contact["linkedin"] or None, "github": contact["github"] or None, "work_authorization": None,
        "summary": _t(data.get("summary")) or None,
        "summary_id": _id() if _t(data.get("summary")) else None,        # the summary is an item too (0011, §3.4)
        "skills": [{"id": _id(), "category": _t(category), "name": name} for category, line in pairs
                   for name in _split(line)],
        "experiences": [{"id": _id(), "job_title": _t(e.get("title")), "company": _t(e.get("company")),
                         "location": _t(e.get("location")), "dates": _t(e.get("date") or e.get("dates")),
                         "start": "", "end": "", "current": "present" in _t(e.get("date") or e.get("dates")).lower(),
                         "bullets": _bullets(e)} for e in dicts("experience")],
        "projects": [{"id": _id(), "name": _t(p.get("name") or p.get("title")), "url": _t(p.get("url")), "dates": "",
                      "technologies": "", "bullets": _bullets(p)} for p in dicts("projects")],
        "educations": [{"id": _id(), "degree": _t(e.get("degree")), "institution": _t(e.get("school")),
                        "graduation_date": _t(e.get("years") or e.get("year") or e.get("date")), "grade": ""}
                       for e in dicts("education")],
        "certifications": entries("certifications"), "awards": entries("awards"), "languages": [],
    }


def json_from_columns(row) -> dict:
    """The downgrade's way back: the columns in JobNavigator's json_data shape."""
    location = ", ".join(x for x in (row.city, row.state) if x)
    items = [{"text": location, "url": ""}] if location else []
    items += [{"text": row.email, "url": f"mailto:{row.email}"}] if row.email else []
    items += [{"text": row.phone, "url": ""}] if row.phone else []
    items += [{"text": link, "url": link} for link in (row.linkedin, row.github) if link]
    skills: dict = {}
    for s in row.skills or []:
        skills.setdefault(s.get("category") or "Skills", []).append(s.get("name"))
    return {
        "header": {"name": row.full_name or "", "title": row.title or "", "contact_items": items},
        "summary": row.summary or "",
        "experience": [{"company": e.get("company", ""), "title": e.get("job_title", ""), "location": e.get("location", ""),
                        "date": e.get("dates", ""), "bullets": [b.get("text", "") for b in e.get("bullets") or []]}
                       for e in row.experiences or []],
        "skills": {k: ", ".join(v) for k, v in skills.items()},
        "education": [{"school": e.get("institution", ""), "degree": e.get("degree", ""),
                       "years": e.get("graduation_date", "")} for e in row.educations or []],
        "projects": [{"name": p.get("name", ""), "url": p.get("url", ""),
                      "bullets": [b.get("text", "") for b in p.get("bullets") or []]} for p in row.projects or []],
    }


_CONTENT = ("full_name", "title", "city", "state", "country", "email", "phone", "linkedin", "github",
            "work_authorization", "summary", "skills", "experiences", "projects", "educations", "certifications",
            "awards", "languages")
_JSONB = {"skills", "experiences", "projects", "educations", "certifications", "awards", "languages"}


def _write_columns(conn, resume_id, values: dict) -> None:
    sets = ", ".join(f"{k} = CAST(:{k} AS jsonb)" if k in _JSONB else f"{k} = :{k}" for k in values)
    params = {k: json.dumps(v) if k in _JSONB else v for k, v in values.items()}
    conn.execute(sa.text(f"UPDATE resumes SET {sets} WHERE id = :rid"), {**params, "rid": resume_id})


def _convert_old_rows(conn) -> None:
    conn.execute(sa.text("DELETE FROM resumes WHERE base_resume_id IS NULL AND candidate_id IS NULL"))
    conn.execute(sa.text("DELETE FROM resumes WHERE base_resume_id IS NULL AND NOT is_base AND job_id IS NULL"))
    old = conn.execute(sa.text(
        "SELECT r.id, r.firm_id, r.candidate_id, r.is_base, r.job_id, r.json_data, r.resume_parse_id, "
        "r.created_by_user_id, r.created_at, c.created_by_user_id AS candidate_maker FROM resumes r "
        "JOIN candidates c ON c.id = r.candidate_id WHERE r.base_resume_id IS NULL "
        "ORDER BY r.created_at, r.id")).mappings().all()
    bases: dict = {}
    for row in (r for r in old if r["is_base"]):
        used = row["resume_parse_id"] is not None and conn.execute(sa.text(
            "SELECT 1 FROM base_resumes WHERE resume_parse_id = :p"), {"p": row["resume_parse_id"]}).first()
        has_active = conn.execute(sa.text("SELECT 1 FROM base_resumes WHERE candidate_id = :c AND is_active"),
                                  {"c": row["candidate_id"]}).first()
        base_id, maker = uuid.uuid4(), row["created_by_user_id"] or row["candidate_maker"]
        upload = row["resume_parse_id"] if row["resume_parse_id"] is not None and not used else None
        conn.execute(sa.text(
            "INSERT INTO base_resumes (id, firm_id, candidate_id, source, resume_parse_id, is_active, "
            "created_by_user_id, created_at) VALUES (:id, :firm, :cand, :source, :parse, :active, :maker, "
            "coalesce(CAST(:at AS timestamptz), now()))"),
            {"id": base_id, "firm": row["firm_id"], "cand": row["candidate_id"],
             "source": "UPLOAD" if upload else "PROMOTED", "parse": upload, "active": not has_active,
             "maker": maker, "at": row["created_at"]})
        bases[row["candidate_id"]] = base_id
        conn.execute(sa.text("UPDATE resumes SET base_resume_id = :b, category = 'BASE', version = 1, "
                             "created_by_user_id = :maker WHERE id = :id"), {"b": base_id, "maker": maker, "id": row["id"]})
        _write_columns(conn, row["id"], columns_from_json(row["json_data"]))
    numbers: dict = {}
    for row in (r for r in old if not r["is_base"]):
        base_id = bases.get(row["candidate_id"]) or conn.execute(sa.text(
            "SELECT id FROM base_resumes WHERE candidate_id = :c AND is_active"), {"c": row["candidate_id"]}).scalar()
        if base_id is None:
            conn.execute(sa.text("DELETE FROM resumes WHERE id = :id"), {"id": row["id"]})
            continue
        key = (base_id, row["job_id"])
        if key not in numbers:
            numbers[key] = conn.execute(sa.text(
                "SELECT coalesce(max(version), 0) FROM resumes WHERE base_resume_id = :b AND category = 'TAILORED' "
                "AND job_id = :j"), {"b": base_id, "j": row["job_id"]}).scalar()
        numbers[key] += 1
        conn.execute(sa.text("UPDATE resumes SET base_resume_id = :b, category = 'TAILORED', version = :v, "
                             "created_by_user_id = :maker WHERE id = :id"),
                     {"b": base_id, "v": numbers[key], "maker": row["created_by_user_id"] or row["candidate_maker"],
                      "id": row["id"]})
        _write_columns(conn, row["id"], columns_from_json(row["json_data"]))


def upgrade() -> None:
    _convert_old_rows(op.get_bind())

    op.drop_index('uq_resumes_one_base_per_candidate', table_name='resumes', postgresql_where=sa.text(_ONE_BASE))
    op.drop_constraint('resumes_parent_id_fkey', 'resumes', type_='foreignkey')
    op.drop_constraint('resumes_resume_parse_id_fkey', 'resumes', type_='foreignkey')
    for name in ('is_base', 'parent_id', 'json_data', 'resume_parse_id', 'updated_at'):
        op.drop_column('resumes', name)
    op.drop_column('resume_parses', 'updated_at')

    op.drop_constraint('ck_resumes_base_has_candidate', 'resumes', type_='check')
    op.drop_constraint('ck_resumes_category_job', 'resumes', type_='check')
    op.create_check_constraint('ck_resumes_category_job', 'resumes', _CATEGORY_JOB)
    op.drop_index('uq_resumes_version', table_name='resumes', postgresql_nulls_not_distinct=True,
                  postgresql_where=sa.text('base_resume_id IS NOT NULL'))
    op.create_index('uq_resumes_version', 'resumes', ['base_resume_id', 'category', 'job_id', 'version'], unique=True,
                    postgresql_nulls_not_distinct=True)
    op.alter_column('resumes', 'base_resume_id', nullable=False)
    op.alter_column('resumes', 'candidate_id', nullable=False)


def downgrade() -> None:
    op.alter_column('resumes', 'candidate_id', nullable=True)
    op.alter_column('resumes', 'base_resume_id', nullable=True)
    op.drop_index('uq_resumes_version', table_name='resumes', postgresql_nulls_not_distinct=True)
    op.create_index('uq_resumes_version', 'resumes', ['base_resume_id', 'category', 'job_id', 'version'], unique=True,
                    postgresql_nulls_not_distinct=True, postgresql_where=sa.text('base_resume_id IS NOT NULL'))
    op.drop_constraint('ck_resumes_category_job', 'resumes', type_='check')
    op.create_check_constraint('ck_resumes_category_job', 'resumes', _CATEGORY_JOB_OLD)
    op.create_check_constraint('ck_resumes_base_has_candidate', 'resumes',
                               'base_resume_id IS NULL OR candidate_id IS NOT NULL')

    op.add_column('resume_parses', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
                                             nullable=False))
    op.add_column('resumes', sa.Column('is_base', sa.Boolean(), nullable=True))
    op.add_column('resumes', sa.Column('parent_id', sa.UUID(), nullable=True))
    op.add_column('resumes', sa.Column('json_data', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('resumes', sa.Column('resume_parse_id', sa.UUID(), nullable=True))
    op.add_column('resumes', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key('resumes_parent_id_fkey', 'resumes', 'resumes', ['parent_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key('resumes_resume_parse_id_fkey', 'resumes', 'resume_parses', ['resume_parse_id'], ['id'],
                          ondelete='RESTRICT')
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE resumes SET is_base = (category = 'BASE'), updated_at = created_at"))
    for row in conn.execute(sa.text(f"SELECT id, {', '.join(_CONTENT)} FROM resumes")).all():
        conn.execute(sa.text("UPDATE resumes SET json_data = CAST(:j AS json) WHERE id = :id"),
                     {"j": json.dumps(json_from_columns(row)), "id": row.id})
    op.create_index('uq_resumes_one_base_per_candidate', 'resumes', ['candidate_id'], unique=True,
                    postgresql_where=sa.text(_ONE_BASE))
