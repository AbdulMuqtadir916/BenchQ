"""No MANUAL bases: a candidate is onboarded only with their résumé (Abdul, 2026-11-06; 07 Q58).

0015 let a candidate be created from the form alone, with a MANUAL base built from it. That option is gone, so:
1. Every MANUAL base becomes an UPLOAD base: a résumé file is generated from its v1's details (a one-page PDF and its
   parse, `backend/candidates/generated_resume.py`; no AI) and kept in `resume_parses` for that candidate.
2. A former placeholder next to a real résumé (the candidate has another live base, and the placeholder holds no work
   history, education or projects) is soft-deleted; when it was the active one, the newest other base becomes active.
3. `base_resumes.source` allows only UPLOAD and PROMOTED again.

The downgrade only lets MANUAL back into the checks; the converted bases stay UPLOAD. Follows 0017.
"""
import json
import uuid

from alembic import op
import sqlalchemy as sa

revision = '0018'
down_revision = '0017'
branch_labels = None
depends_on = None


def upgrade() -> None:
    from backend.candidates.generated_resume import PDF_MIME, from_details, sha256
    conn = op.get_bind()
    manual = conn.execute(sa.text("""
        SELECT b.id, b.firm_id, b.candidate_id, b.created_by_user_id, b.created_at,
               r.full_name, r.title, r.email, r.phone, r.linkedin, r.city, r.state, r.country, r.work_authorization,
               r.summary, r.skills
        FROM base_resumes b
        LEFT JOIN resumes r ON r.base_resume_id = b.id AND r.category = 'BASE' AND r.version = 1
        WHERE b.source = 'MANUAL'
    """)).mappings().all()
    for row in manual:
        skills = [s.get("name") for s in (row["skills"] or []) if isinstance(s, dict) and s.get("name")]
        content, parse = from_details(
            name=row["full_name"] or "Candidate", title=row["title"], email=row["email"], phone=row["phone"],
            linkedin=row["linkedin"], city=row["city"], state=row["state"], country=row["country"],
            work_authorization=row["work_authorization"], summary=row["summary"], skills=skills, salt=str(row["id"]))
        parse_id = uuid.uuid4()
        conn.execute(sa.text("""
            INSERT INTO resume_parses (id, firm_id, uploaded_by_user_id, candidate_id, file_name, mime_type, size_bytes,
                                       content, content_sha256, parse, expires_at, created_at)
            VALUES (:id, :firm, :by, :cand, :name, :mime, :size, :content, :sha, CAST(:parse AS jsonb), NULL, :at)
        """), {"id": parse_id, "firm": row["firm_id"], "by": row["created_by_user_id"], "cand": row["candidate_id"],
               "name": f"{(row['full_name'] or 'Candidate').strip()} - résumé.pdf"[:255], "mime": PDF_MIME,
               "size": len(content), "content": content, "sha": sha256(content), "parse": json.dumps(parse),
               "at": row["created_at"]})
        conn.execute(sa.text("UPDATE base_resumes SET source = 'UPLOAD', resume_parse_id = :p WHERE id = :b"),
                     {"p": parse_id, "b": row["id"]})

    # Former placeholders next to a real résumé go (soft delete, like any delete; the ledger isn't written here).
    placeholders = conn.execute(sa.text("""
        SELECT b.id, b.candidate_id, b.is_active FROM base_resumes b
        WHERE b.id = ANY(:ids) AND b.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM resumes r WHERE r.base_resume_id = b.id AND r.deleted_at IS NULL
                          AND (r.experiences <> '[]'::jsonb OR r.educations <> '[]'::jsonb OR r.projects <> '[]'::jsonb))
          AND EXISTS (SELECT 1 FROM base_resumes o WHERE o.candidate_id = b.candidate_id AND o.id <> b.id
                      AND o.deleted_at IS NULL AND NOT (o.id = ANY(:ids)))
    """), {"ids": [r["id"] for r in manual]}).mappings().all()
    for p in placeholders:
        conn.execute(sa.text("UPDATE base_resumes SET deleted_at = now(), is_active = false WHERE id = :b"), {"b": p["id"]})
        conn.execute(sa.text("UPDATE resumes SET deleted_at = now() WHERE base_resume_id = :b AND deleted_at IS NULL"),
                     {"b": p["id"]})
        if p["is_active"]:
            conn.execute(sa.text("""
                UPDATE base_resumes SET is_active = true WHERE id = (
                    SELECT id FROM base_resumes WHERE candidate_id = :c AND deleted_at IS NULL
                    ORDER BY created_at DESC LIMIT 1)
            """), {"c": p["candidate_id"]})

    op.drop_constraint('ck_base_resumes_source', 'base_resumes', type_='check')
    op.drop_constraint('ck_base_resumes_source_values', 'base_resumes', type_='check')
    op.create_check_constraint('ck_base_resumes_source_values', 'base_resumes', "source IN ('UPLOAD', 'PROMOTED')")
    op.create_check_constraint('ck_base_resumes_source', 'base_resumes',
                               "source = 'PROMOTED' OR resume_parse_id IS NOT NULL")


def downgrade() -> None:
    op.drop_constraint('ck_base_resumes_source', 'base_resumes', type_='check')
    op.drop_constraint('ck_base_resumes_source_values', 'base_resumes', type_='check')
    op.create_check_constraint('ck_base_resumes_source_values', 'base_resumes',
                               "source IN ('UPLOAD', 'PROMOTED', 'MANUAL')")
    op.create_check_constraint('ck_base_resumes_source', 'base_resumes',
                               "source IN ('PROMOTED', 'MANUAL') OR resume_parse_id IS NOT NULL")
