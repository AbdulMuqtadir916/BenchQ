"""Reading a résumé for the new-candidate flow (docs/candidate-onboarding/06-backend.md §4; 07 Q49).

PDF or Word in, Zuhair's parser format out (the table in 06 §4, mapped on the frontend by
src/lib/api/dto/resume-parse.ts). The text comes from pdfplumber or python-docx; one call to the model of the
`resume_parse` AI module turns it into the format, with the module's prompt (a platform setting, so it can be replaced
without a release). The answer is checked against the format and anything missing becomes "" or []. Nothing here
saves a candidate: the route keeps the file and the answer for 60 minutes (`resume_parses`).
"""
import io
import json

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

MAX_BYTES = 10 * 1024 * 1024                       # the frontend's RESUME_FILE.maxBytes
PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MIN_TEXT = 50                                      # fewer characters than this is a scan or an empty file

SYSTEM_PROMPT = ("You read résumés. Return ONLY valid JSON in the format you are given, with no markdown fences "
                 "and no commentary. Copy facts exactly as printed; never invent, infer or improve anything.")


# ── The format (Zuhair's "Response Formats For Parser And Tailoring Resume", the parser half) ─────────────────────

class _Lenient(BaseModel):
    """Extra keys are dropped and missing ones default, so a model's small slips don't fail the whole read."""
    model_config = ConfigDict(extra="ignore")


class Header(_Lenient):
    name: str = ""
    title: str = ""
    location: str = ""
    email: str = ""
    phone: str = ""
    work_authorization: str = ""
    github: str = ""
    linkedin: str = ""


class SkillGroup(_Lenient):
    category: str = ""
    skills: str = ""


class Job(_Lenient):
    job_title: str = ""
    company: str = ""
    location: str = ""
    dates: str = ""
    start: str = ""
    end: str = ""
    current: bool = False
    bullets: list[str] = Field(default_factory=list)


class Project(_Lenient):
    name: str = ""
    url: str = ""
    dates: str = ""
    technologies: str = ""
    bullets: list[str] = Field(default_factory=list)


class Education(_Lenient):
    degree: str = ""
    institution: str = ""
    graduation_date: str = ""
    grade: str = ""


class ParsedResume(_Lenient):
    header: Header = Field(default_factory=Header)
    professional_summary: str = ""
    technical_skills: list[SkillGroup] = Field(default_factory=list)
    work_experience: list[Job] = Field(default_factory=list)
    projects: list[Project] = Field(default_factory=list)
    education: list[Education] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)


EMPTY_FORMAT = json.dumps(ParsedResume().model_dump() | {
    "technical_skills": [SkillGroup().model_dump()], "work_experience": [Job().model_dump()],
    "projects": [Project().model_dump()], "education": [Education().model_dump()], "certifications": [""],
})

# The default prompt (seeded as the `resume_parse_prompt` setting). {format} and {resume_text} are filled in.
DEFAULT_PROMPT = """Read the résumé text below and return ONLY this JSON:
{format}

Rules:
- A field the résumé doesn't have is "" (or [] for a list). Never guess.
- header.title: the headline printed under the name; if there is none, the title of the most recent job.
- header.location: where the candidate lives, from the header only, never a job's location.
- header.work_authorization: the visa or citizenship status, only if printed.
- header.github and header.linkedin: the full links, as printed.
- professional_summary: the short paragraph about the candidate, including total years of experience if stated.
- technical_skills: the groups as printed; each group's skills as one comma-separated string.
- work_experience: every job, in the résumé's order. dates exactly as printed. start and end as "YYYY-MM", or "YYYY"
  when no month is printed; start is "" when only one date is printed; end is "" when the job is ongoing, and current
  is then true. Every bullet of the job, none dropped or reworded.
- projects: every project, in the résumé's order, with its bullets.
- education: every entry, school-level included; graduation_date and grade exactly as printed.
- certifications: each certification once.

Résumé text:
{resume_text}"""


# ── The file ─────────────────────────────────────────────────────────────────────────────────────────────────────

def file_kind(file_name: str, content: bytes) -> str:
    """"pdf" or "docx", from the name and the bytes. The frontend checks first; this is the check a request can't
    skip. Wording as the frontend's resumeFileProblem."""
    name = (file_name or "").lower()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Up to 10 MB.")
    if not content:
        raise HTTPException(status_code=422, detail="This file is empty.")
    if name.endswith(".doc"):
        raise HTTPException(status_code=415, detail="Save it as .docx or PDF, then try again.")
    if name.endswith(".pdf") and content.startswith(b"%PDF"):
        return "pdf"
    if name.endswith(".docx") and content.startswith(b"PK"):
        return "docx"
    raise HTTPException(status_code=415, detail="PDF or Word only.")


def extract_text(kind: str, content: bytes) -> str:
    """The résumé's text, or 422 when there isn't enough to read (a scan, a damaged file)."""
    text = ""
    try:
        if kind == "pdf":
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        else:
            import docx
            document = docx.Document(io.BytesIO(content))
            lines = [paragraph.text for paragraph in document.paragraphs]
            for table in document.tables:         # many résumés put skills or contact details in a table
                for row in table.rows:
                    lines.append(" | ".join(cell.text for cell in row.cells))
            text = "\n".join(lines)
    except Exception:
        raise HTTPException(status_code=422, detail="Couldn't open this file. It may be damaged.")
    if len(text.strip()) < MIN_TEXT:
        raise HTTPException(status_code=422, detail="This résumé has no readable text. It may be a scanned image.")
    return text


# ── Reading it ───────────────────────────────────────────────────────────────────────────────────────────────────

def checked(answer: dict) -> dict:
    """The model's answer in exactly the format: unknown keys dropped, missing ones filled. 422 if it isn't one."""
    try:
        return ParsedResume.model_validate(answer).model_dump()
    except ValidationError:
        raise HTTPException(status_code=422, detail="Couldn't read this résumé. Try another file, or enter the details yourself.")


async def read_resume(text: str, db) -> dict:
    """One call to the `resume_parse` module's model, logged to llm_call_log as purpose "resume_parse"."""
    from backend.ai.config import ai_config
    from backend.analyzer.llm_client import call_llm
    from backend.analyzer.llm_logger import track_llm_call
    from backend.analyzer.model_json import parse_model_json

    cfg = ai_config("resume_parse", db=db)
    prompt = cfg.prompt("parse").replace("{format}", EMPTY_FORMAT).replace("{resume_text}", text)
    try:
        async with track_llm_call("resume_parse", cfg.provider, cfg.model) as tracker:
            response = await call_llm(prompt=prompt, system=SYSTEM_PROMPT, max_tokens=8000, provider=cfg.provider,
                                      model=cfg.model, api_key=cfg.api_key, effort=cfg.effort)
            tracker.record(response)
    except Exception:
        raise HTTPException(status_code=502, detail="The résumé reader didn't answer. Try again in a minute.")
    try:
        answer = parse_model_json(response["text"])
    except (json.JSONDecodeError, KeyError, TypeError):
        raise HTTPException(status_code=422, detail="Couldn't read this résumé. Try another file, or enter the details yourself.")
    return checked(answer if isinstance(answer, dict) else {})
