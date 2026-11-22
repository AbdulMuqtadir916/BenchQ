"""Reading a résumé for the new-candidate flow (docs/candidate-onboarding/06-backend.md §4; 07 Q49), with the
base-résumé parser (docs/team/resume-versioning.md §2).

PDF or DOCX in (nothing else, 2026-11-17 Q108), the parser's response format out (mapped on the frontend by
src/lib/api/dto/resume-parse.ts). The text comes from pdfplumber or python-docx, with the link addresses the file embeds
added at the end. A PDF that is only a picture of a résumé (a scan; pdfplumber finds no text) is read by RapidOCR, its
first pages only, on this server: no file leaves it. One call to the
`resume_parse` module's own model (its own settings, never the shared ones; §2.2) turns it into the strict format,
and `clean_reply` (backend/candidates/base_resume.py) fixes the values while keeping the format's keys. Nothing here
saves a candidate: the route keeps the file and the answer for 60 minutes (`resume_parses`).

No résumé content goes into the logs: a firm's candidate data is not the server log's to keep.
"""
import io
import json
import logging

from fastapi import HTTPException

from backend.candidates.parse_defaults import (DEFAULT_RESPONSE_FORMAT, DOCX_INPUT_NOTE, INPUT_NOTE, PDF_INPUT_NOTE,
                                               RESUME)

logger = logging.getLogger("jobnavigator.resume_parse")

MAX_BYTES = 10 * 1024 * 1024                       # the frontend's RESUME_FILE.maxBytes
PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MIN_TEXT = 50                                      # fewer characters than this is a scan or an empty file
OCR_MOST_PAGES = 4                                 # a scanned résumé's pages read by OCR; a page takes a few seconds
OCR_RESOLUTION = 200                               # dots per inch the page is drawn at for OCR

# The parse call (resume-versioning.md §2.1): a long résumé needs about 8k output tokens; someone watches the spinner.
MAX_OUTPUT_TOKENS = 16000
ATTEMPT_SECONDS = 80
# The top-level keys clean_reply reads; a format whose schema doesn't require all of them can't fill the parse.
REPLY_KEYS = ("header", "professional_summary", "technical_skills", "work_experience", "projects", "education",
              "certifications", "awards", "languages")
_LINK_SCHEMES = ("http://", "https://", "mailto:")
LINKS_HEADING = "\n\nLink addresses embedded in the "      # + "PDF:" or "document:" (the input notes name both)


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
    raise HTTPException(status_code=415, detail="PDF or DOCX only.")


def _links_block(links: list[str], where: str) -> str:
    """The addresses a hyperlinked label hides ("LinkedIn" prints none), http(s) and mailto only, each once, in order."""
    kept = list(dict.fromkeys(link.strip() for link in links if link and link.strip().lower().startswith(_LINK_SCHEMES)))
    return f"{LINKS_HEADING}{where}:\n" + "\n".join(kept) if kept else ""


def _pdf_text(content: bytes) -> tuple[str, list[str]]:
    import pdfplumber
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        text = "".join(page_text + "\n" for page_text in (page.extract_text() for page in pdf.pages) if page_text)
        if len(text.strip()) < MIN_TEXT:
            text = _ocr_text(pdf) or text
        links = []
        try:
            links = [str(link.get("uri") or "") for page in pdf.pages for link in page.hyperlinks]
        except Exception:
            logger.warning("Couldn't read the PDF's link addresses; parsing without them", exc_info=True)
    return text, links


_ocr_engine = None


def _ocr():
    """RapidOCR, loaded once per process (its models ship inside the package: nothing is downloaded)."""
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr_engine = RapidOCR()
    return _ocr_engine


def ocr_lines(boxes) -> list[str]:
    """RapidOCR's boxes ([corners, text, score], in no set order) as lines, top to bottom and left to right: boxes whose
    middles sit within half a box's height of each other are one line."""
    found = []
    for corners, words, _score in boxes or ():
        ys, xs = [point[1] for point in corners], [point[0] for point in corners]
        if str(words).strip():
            found.append(((min(ys) + max(ys)) / 2, max(max(ys) - min(ys), 1), min(xs), str(words).strip()))
    lines: list[list] = []
    for middle, height, left, words in sorted(found):
        if lines and abs(middle - lines[-1][0]) <= height / 2:
            lines[-1][1].append((left, words))
        else:
            lines.append([middle, [(left, words)]])
    return [" ".join(words for _left, words in sorted(parts)) for _middle, parts in lines]


def _ocr_text(pdf) -> str:
    """The text of a scanned PDF's first pages by OCR, or "" when it can't be read. Logs counts and timings only."""
    import time
    started = time.monotonic()
    pages = pdf.pages[:OCR_MOST_PAGES]
    try:
        engine = _ocr()
        text = "".join("\n".join(ocr_lines(engine(page.to_image(resolution=OCR_RESOLUTION).original.convert("RGB"))[0]))
                       + "\n" for page in pages)
    except Exception as error:
        logger.warning("Résumé OCR failed %s", type(error).__name__)
        return ""
    logger.info("Résumé PDF read by OCR pages=%d of=%d characters=%d seconds=%.1f", len(pages), len(pdf.pages),
                len(text.strip()), time.monotonic() - started)
    return text


def _docx_text(content: bytes) -> tuple[str, list[str]]:
    """Paragraphs and tables in the order the document shows them (a header laid out in a table stays on top), each
    table row one line with its cells split by " | "."""
    import docx
    from docx.table import Table
    document = docx.Document(io.BytesIO(content))
    lines, paragraphs = [], []
    for block in document.iter_inner_content():
        if isinstance(block, Table):
            for row in block.rows:
                cells = list(dict.fromkeys(cell for cell in row.cells))     # a merged cell repeats across its columns
                lines.append(" | ".join(cell.text for cell in cells))
                paragraphs += [p for cell in cells for p in cell.paragraphs]
        else:
            lines.append(block.text)
            paragraphs.append(block)
    links = []
    try:
        links = [str(link.address or "") for paragraph in paragraphs for link in paragraph.hyperlinks]
    except Exception:
        logger.warning("Couldn't read the document's link addresses; parsing without them", exc_info=True)
    return "\n".join(lines), links


def extract_text(kind: str, content: bytes) -> str:
    """The résumé's text with its link addresses at the end, or 422 when there isn't enough to read (a scan, a
    damaged file). Blocking work: the route runs it off the event loop."""
    try:
        text, links = _pdf_text(content) if kind == "pdf" else _docx_text(content)
    except Exception:
        raise HTTPException(status_code=422, detail="Couldn't open this file. It may be damaged.")
    if len(text.strip()) < MIN_TEXT:
        raise HTTPException(status_code=422, detail="This résumé has no readable text, even read as an image.")
    return text.rstrip() + _links_block(links, "PDF" if kind == "pdf" else "document")


# ── The setup it runs on ─────────────────────────────────────────────────────────────────────────────────────────

def _setup_error(detail: str) -> HTTPException:
    logger.error("The résumé parser isn't set up: %s", detail)
    return HTTPException(status_code=500, detail=f"The résumé reader isn't set up: {detail}.")


# ── Reading it ───────────────────────────────────────────────────────────────────────────────────────────────────

async def read_resume(text: str, kind: str, db, firm_id=None) -> dict:
    """One call to the parser's model, logged to llm_call_log as purpose "resume_parse" under the firm it was for
    (AI spend per firm, Q33); the cleaned reply."""
    from backend.ai.config import ai_config
    from backend.analyzer.llm_client import LLMDeadlineError, call_llm
    from backend.analyzer.llm_logger import track_llm_call
    from backend.analyzer.model_json import parse_model_json
    from backend.analyzer.prompt_fence import fence
    from backend.candidates.base_resume import clean_reply, dropped_source_terms
    from backend.job_monitor import get_limiter

    cfg = ai_config("resume_parse", db=db)
    if cfg.provider != "openrouter":
        raise _setup_error("the AI provider must be openrouter")
    if not cfg.model:
        raise _setup_error("no active AI preset")
    if not cfg.api_key:
        raise _setup_error("the AI API key is not set")
    try:
        system, template = cfg.prompt("system"), cfg.prompt("parse")
    except RuntimeError as e:
        raise _setup_error(str(e).rstrip("."))
    if RESUME not in template:
        raise _setup_error("the parse prompt needs the {resume} placeholder")
    # The setup is read; end the transaction so the connection goes back to the pool while the model works (up
    # to minutes). Holding it would let some 30 parses at once drain the pool for every firm (backend/models/db.py).
    db.commit()

    note = PDF_INPUT_NOTE if kind == "pdf" else DOCX_INPUT_NOTE
    # Plain replace, never .format (the rules hold braces); {resume} last, so a résumé printing "{input_note}" stays.
    prompt = template.replace(INPUT_NOTE, note).replace(RESUME, fence(text, "RESUME", note=False))
    try:
        # At most `resume_parse_max_concurrent` parses at once per backend process; the rest wait here.
        async with get_limiter("resume_parse"):
            async with track_llm_call("resume_parse", "openrouter", cfg.model, firm_id=firm_id,
                                      preset_id=cfg.preset_id, preset_version=cfg.preset_version) as tracker:
                response = await call_llm(prompt=prompt, system=system, max_tokens=MAX_OUTPUT_TOKENS,
                                          provider="openrouter", model=cfg.model, api_key=cfg.api_key,
                                          effort=cfg.effort, response_format=json.loads(DEFAULT_RESPONSE_FORMAT),
                                          reasoning_off=not cfg.effort, use_fallback=False, retry_cut_off=True,
                                          attempt_timeout=ATTEMPT_SECONDS)
                tracker.record(response)
    except LLMDeadlineError:
        logger.warning("Résumé parse timed out after %ss", ATTEMPT_SECONDS)
        raise HTTPException(status_code=504, detail="There was an issue while parsing your resume, please try again.")
    except Exception as e:
        # The provider's error, never the prompt: it names the status ("502", "No endpoints found"), not the résumé.
        logger.warning("Résumé parse failed after every attempt: %s", str(e)[:300])
        raise HTTPException(status_code=500, detail="The résumé reader didn't answer. Try again in a minute.")
    raw = response.get("text") if isinstance(response, dict) else None
    try:
        answer = parse_model_json(raw or "")
    except json.JSONDecodeError as e:
        logger.warning("Résumé parse reply had no readable JSON (%d characters; %s at %d)",
                       len(raw or ""), e.msg, e.pos)
        raise HTTPException(status_code=422, detail="Couldn't read this résumé. Try another file, or enter the details yourself.")
    parse = clean_reply(answer, source_text=text)
    # The link block is ours, not the résumé's: its heading would always count "PDF" as a dropped term.
    dropped = dropped_source_terms(parse, text.split(LINKS_HEADING, 1)[0])
    if dropped:
        logger.warning("Résumé parse left out %d terms the file names; worth a look by hand", len(dropped))
    return parse
