"""Routes that write a person's data to the log, the ways a teammate plausibly would; the two log guards are measured
against them (test_log_lint.py reads them, test_log_every_route.py runs them). Not part of the app: the tests mount
them on an app of their own. Written 2026-11-04, before either guard, so neither was built around them.

`LEAKS` names each leaky route; `SAFE` names routes that log only ids, counts and the like, so a guard that flags
them is crying wolf. Each route logs at INFO or above, the level production writes.
"""
import logging
import uuid

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.analyzer import llm_client
from backend.models.candidates import Candidate
from backend.models.db import get_db
from backend.tests.log_leak_helpers import display_label

logger = logging.getLogger("jobnavigator.leakcases")
router = APIRouter()


class PersonIn(BaseModel):
    full_name: str
    notes: str = ""
    skills: list[str] = []
    years: int = 1


def _short(c):
    return c.full_name.split()[0]


def _audit(who):
    logger.info("audit: %s", who)


class Service:
    def __init__(self):
        self.logger = logging.getLogger("jobnavigator.leakcases.service")

    def create(self, person):
        self.logger.info(f"Service created {person.full_name}")


# ── From the request body ──────────────────────────────────────────────────

@router.post("/leak/f-string")
def f_string(body: PersonIn):
    logger.info(f"Created {body.full_name}")


@router.post("/leak/renamed")
def renamed(body: PersonIn):
    n = body.full_name
    logger.info("Created %s", n)


@router.post("/leak/whole-body")
def whole_body(body: PersonIn):
    logger.info("Body: %s", body)


@router.post("/leak/model-dump")
def model_dump(body: PersonIn):
    logger.info("Data %s", body.model_dump())


@router.post("/leak/unlisted-field")
def unlisted_field(body: PersonIn):
    logger.info("Note %s", body.notes)


@router.post("/leak/dict")
def built_dict(body: PersonIn):
    info = {"who": body.full_name, "n": body.years}
    logger.info("%s", info)


@router.post("/leak/concat")
def concat(body: PersonIn):
    logger.warning("Hi " + body.full_name)


@router.post("/leak/percent")
def percent(body: PersonIn):
    logger.info("Hi %s" % body.full_name)


@router.post("/leak/format")
def dot_format(body: PersonIn):
    logger.info("Hi {}".format(body.full_name))


@router.post("/leak/get-logger")
def get_logger_inline(body: PersonIn):
    logging.getLogger("jobnavigator.other").info(f"Other {body.full_name}")


@router.post("/leak/self-logger")
def self_logger(body: PersonIn):
    Service().create(body)


@router.post("/leak/loop")
def loop(body: PersonIn):
    for skill in body.skills:
        logger.info("skill %s", skill)


@router.post("/leak/helper-same-file")
def helper_same_file(body: PersonIn):
    logger.info("Short %s", _short(body))


@router.post("/leak/helper-other-file")
def helper_other_file(body: PersonIn):
    logger.info("Label %s", display_label(body))


@router.post("/leak/argument-to-helper")
def argument_to_helper(body: PersonIn):
    _audit(body.full_name)


@router.post("/leak/exception-text")
def exception_text(body: PersonIn):
    try:
        raise ValueError(f"bad name {body.full_name}")
    except ValueError as e:
        logger.warning(f"Failed: {e}")


@router.post("/leak/background-task")
def background_task(body: PersonIn, tasks: BackgroundTasks):
    tasks.add_task(_audit, body.full_name)


@router.post("/leak/only-on-timeout")
def only_on_timeout(body: PersonIn):
    try:
        uuid.uuid4()
    except TimeoutError:
        logger.warning("timed out for %s", body.full_name)


@router.post("/leak/only-if-senior")
def only_if_senior(body: PersonIn):
    if body.years > 40:
        logger.info("senior: %s", body.full_name)


# ── From a stored record ───────────────────────────────────────────────────

@router.get("/leak/record/{candidate_id}")
def record(candidate_id: uuid.UUID, db: Session = Depends(get_db)):
    candidate = db.get(Candidate, candidate_id)
    logger.info(f"Loaded {candidate.full_name}")


@router.get("/leak/record-list")
def record_list(db: Session = Depends(get_db)):
    for c in db.query(Candidate).all():
        logger.info("notes %s", c.contact_notes)


@router.get("/leak/record-whole/{candidate_id}")
def record_whole(candidate_id: uuid.UUID, db: Session = Depends(get_db)):
    row = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    logger.info("row %s", vars(row))


# ── From the AI or another service ─────────────────────────────────────────

@router.post("/leak/ai-reply")
async def ai_reply(body: PersonIn):
    result = await llm_client.call_llm("p", "s", 100)
    logger.warning(f"Model said {result['text'][:200]}")


@router.post("/leak/ai-text")
async def ai_text(body: PersonIn):
    out = await llm_client.call_llm("p", "s", 100)
    text = out["text"]
    logger.info(text)


@router.get("/leak/http-reply")
async def http_reply():
    async with httpx.AsyncClient() as client:
        r = await client.get("https://example.test/me")
    logger.error("Google: %s", r.text)


@router.get("/leak/http-json")
async def http_json():
    async with httpx.AsyncClient() as client:
        r = await client.get("https://example.test/me")
    data = r.json()
    logger.info("got %s", data)


# ── From the URL or an upload ──────────────────────────────────────────────

@router.get("/leak/path-token/{token}")
def path_token(token: str):
    logger.info(f"Invite {token}")


@router.get("/leak/query")
def query(q: str = ""):
    logger.info("search %s", q)


@router.post("/leak/upload-name")
async def upload_name(file: UploadFile = File(...)):
    logger.info("Got %s", file.filename)


@router.post("/leak/upload-content")
async def upload_content(file: UploadFile = File(...)):
    content = (await file.read()).decode(errors="ignore")
    logger.info("starts %s", content[:80])


# ── Safe: ids, counts, statuses, companies ─────────────────────────────────

@router.post("/safe/length")
def safe_length(body: PersonIn):
    logger.info("name has %d characters, %d skills", len(body.full_name), len(body.skills))


@router.get("/safe/record-id/{candidate_id}")
def safe_record_id(candidate_id: uuid.UUID, db: Session = Depends(get_db)):
    candidate = db.get(Candidate, candidate_id)
    logger.info("Loaded candidate %s (firm %s)", candidate.id, candidate.firm_id)


@router.get("/safe/count")
def safe_count(db: Session = Depends(get_db)):
    logger.info("%d candidates", db.query(Candidate).count())


@router.get("/safe/http-status")
async def safe_http_status():
    async with httpx.AsyncClient() as client:
        r = await client.get("https://example.test/me")
    logger.info("Google answered %s", r.status_code)


@router.post("/safe/ai-usage")
async def safe_ai_usage(body: PersonIn):
    result = await llm_client.call_llm("p", "s", 100)
    logger.info("reply had %d characters", len(result["text"]))


@router.post("/safe/plain-error")
def safe_plain_error(body: PersonIn):
    try:
        int("x")
    except ValueError as e:
        logger.warning("could not read the setting: %s", e)


@router.get("/safe/company")
def safe_company(company: str = "Acme"):
    logger.info("scraping %s", company.lower() == "acme")


@router.post("/safe/years")
def safe_years(body: PersonIn):
    logger.info("years %d", body.years)


@router.get("/safe/fixed")
def safe_fixed():
    logger.info("digest sent")


@router.post("/safe/flag")
def safe_flag(body: PersonIn):
    logger.info("has notes: %s", bool(body.notes))


LEAKS = sorted(r.path for r in router.routes if r.path.startswith("/leak/"))
SAFE = sorted(r.path for r in router.routes if r.path.startswith("/safe/"))
