"""A résumé version's file when it has no upload of its own (docs/02 §8.2). Only an uploaded base's version 1 is a file
as uploaded; any other version (a later one, a promoted base's, a tailored one) is laid out here from its own columns,
when asked: one plain, single-column page, as HTML the route prints to PDF with the backend's headless Chromium, or as a
Word file. No AI: every word is the version's, in `resume_text`'s order (§4.8); work authorization and languages stay
out, as on the studio's paper. A version's row never changes, so the same version always comes out the same."""
import html as _html
import io
import re

from backend.candidates.resume_text import _join, _t

_SCHEME = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.\-]*):")
_UNSAFE_NAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')
# Control characters a PDF's text can carry: Word's XML refuses them, so they're dropped (tabs and line breaks stay).
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# The same margins on paper and in Word, in inches.
_MARGINS = {"top": 0.55, "bottom": 0.55, "left": 0.6, "right": 0.6}

_CSS = """
* { box-sizing: border-box; }
body { margin: 0; color: black; font: 10.5pt/1.35 "Liberation Sans", "DejaVu Sans", Arial, Helvetica, sans-serif; }
a { color: inherit; text-decoration: none; }
h1 { margin: 0; font-size: 18pt; line-height: 1.2; }
.title { margin-top: 2pt; font-size: 11.5pt; }
.contact { margin-top: 4pt; font-size: 9.5pt; }
.contact span + span::before { content: " | "; }
h2 { margin: 12pt 0 5pt; padding-bottom: 2pt; border-bottom: 1px solid black; font-size: 11pt; letter-spacing: 0.04em;
     text-transform: uppercase; break-after: avoid; }
.entry { margin-bottom: 6pt; }
.row { display: flex; justify-content: space-between; gap: 12pt; break-after: avoid; }
.head { font-weight: bold; }
.side { white-space: nowrap; }
.sub { font-style: italic; }
.text { white-space: pre-line; }
.label { font-weight: bold; }
ul { margin: 2pt 0 0; padding-left: 14pt; }
li { margin: 1pt 0; }
"""


def is_a4(page_format) -> bool:
    """The version's paper: A4 when it says so, else Letter (the column's default)."""
    return _t(page_format).lower() == "a4"


def pdf_options(page_format) -> dict:
    """Playwright's `page.pdf` options for the version's paper."""
    return {"format": "A4" if is_a4(page_format) else "Letter", "print_background": True,
            "margin": {side: f"{inches}in" for side, inches in _MARGINS.items()}}


def web_address(value) -> str | None:
    """Where a link may point: an http(s) address as written, a bare one (`linkedin.com/in/…`) with https:// added.
    Anything else (an email address, `javascript:`, a phone number) isn't linked."""
    value = _t(value)
    if not value or any(ch.isspace() for ch in value):
        return None
    scheme = _SCHEME.match(value)
    if scheme:
        return value if scheme.group(1).lower() in ("http", "https") else None
    return None if "@" in value.split("/", 1)[0] else f"https://{value}"


def file_name(row, extension: str) -> str:
    """`Name - Title.pdf`, from the version's own header (else its name), safe as a file name."""
    base = " - ".join(x for x in (_t(row.full_name), _t(row.title)) if x) or _t(getattr(row, "name", "")) or "Resume"
    base = re.sub(r"\s+", " ", _UNSAFE_NAME.sub(" ", base)).strip()[:120].strip() or "Resume"
    return f"{base}.{extension}"


def _dicts(values) -> list[dict]:
    return [value for value in values or [] if isinstance(value, dict)]


def _scrubbed(value):
    """`value` with the control characters `_CONTROL` names taken out of every string in it."""
    if isinstance(value, str):
        return _CONTROL.sub("", value)
    if isinstance(value, (list, tuple)):
        return type(value)(_scrubbed(item) for item in value)
    if isinstance(value, dict):
        return {key: _scrubbed(item) for key, item in value.items()}
    return value


def _bullets(item: dict) -> list[str]:
    return [_t(b.get("text")) for b in _dicts(item.get("bullets")) if _t(b.get("text"))]


def _dates(item: dict) -> str:
    return _t(item.get("dates")) or _join(item.get("start"), "Present" if item.get("current") else item.get("end"),
                                          sep=" – ")


def layout(row, links: dict | None = None) -> dict:
    """What the file shows: the header, then each section that has something. An entry has any of `head` (bold, linked
    to `href`), `side` (on the right: dates), `sub` (the line under), `label` and `text`, and `bullets`. `links` names
    where LinkedIn and GitHub point (the route's tracer links, when the firm uses them); their text stays as written."""
    links = links or {}
    contact = [(_t(value), None) for value in (row.email, row.phone) if _t(value)]
    if _join(row.city, row.state, row.country):
        contact.append((_join(row.city, row.state, row.country), None))
    for key in ("linkedin", "github"):
        written = _t(getattr(row, key, None))
        if written:
            contact.append((written, web_address(links.get(key) or written)))

    groups: dict[str, list[str]] = {}
    for skill in _dicts(row.skills):
        if _t(skill.get("name")):
            groups.setdefault(_t(skill.get("category")), []).append(_t(skill.get("name")))
    sections = [
        ("Summary", [{"text": _t(row.summary)}]),
        ("Experience", [{"head": _join(e.get("job_title"), e.get("company"), sep=" — "), "side": _dates(e),
                         "sub": _t(e.get("location")), "bullets": _bullets(e)} for e in _dicts(row.experiences)]),
        ("Skills", [{"label": category, "text": ", ".join(names)} for category, names in groups.items()]),
        ("Education", [{"head": _t(e.get("degree")) or _t(e.get("institution")), "side": _t(e.get("graduation_date")),
                        "sub": _join(e.get("institution") if _t(e.get("degree")) else "", e.get("grade"))}
                       for e in _dicts(row.educations)]),
        ("Projects", [{"head": _t(p.get("name")), "href": web_address(p.get("url")), "side": _t(p.get("dates")),
                       "sub": _t(p.get("technologies")), "bullets": _bullets(p)} for p in _dicts(row.projects)]),
    ]
    for heading, key in (("Certifications", "certifications"), ("Awards", "awards")):
        sections.append((heading, [{"head": _t(e.get("name")), "side": _t(e.get("date")), "sub": _t(e.get("issuer")),
                                    "text": _t(e.get("detail"))} for e in _dicts(getattr(row, key, None))
                                   if _t(e.get("name"))]))
    kept = [(heading, [entry for entry in entries if any(entry.values())]) for heading, entries in sections]
    return _scrubbed({"name": _t(row.full_name), "title": _t(row.title), "contact": contact,
                      "sections": [(heading, entries) for heading, entries in kept if entries]})


def _linked(text: str, href: str | None) -> str:
    text = _html.escape(text)
    return f'<a href="{_html.escape(href, quote=True)}">{text}</a>' if href else text


def _entry_html(entry: dict) -> str:
    out = ['<div class="entry">']
    if entry.get("head") or entry.get("side"):
        out.append(f'<div class="row"><span class="head">{_linked(entry.get("head") or "", entry.get("href"))}</span>'
                   f'<span class="side">{_html.escape(entry.get("side") or "")}</span></div>')
    if entry.get("sub"):
        out.append(f'<div class="sub">{_html.escape(entry["sub"])}</div>')
    if entry.get("text"):
        label = f'<span class="label">{_html.escape(entry["label"])}:</span> ' if entry.get("label") else ""
        out.append(f'<div class="text">{label}{_html.escape(entry["text"])}</div>')
    if entry.get("bullets"):
        out.append("<ul>" + "".join(f"<li>{_html.escape(b)}</li>" for b in entry["bullets"]) + "</ul>")
    out.append("</div>")
    return "".join(out)


def html(row, links: dict | None = None) -> str:
    """The version as one HTML page for `page.pdf`, every value escaped and nothing loaded from anywhere."""
    doc = layout(row, links)
    out = ['<!doctype html><html><head><meta charset="utf-8"><title>', _html.escape(doc["name"] or "Resume"),
           f"</title><style>{_CSS}</style></head><body>"]
    if doc["name"]:
        out.append(f"<h1>{_html.escape(doc['name'])}</h1>")
    if doc["title"]:
        out.append(f'<div class="title">{_html.escape(doc["title"])}</div>')
    if doc["contact"]:
        out.append('<div class="contact">' + "".join(f"<span>{_linked(text, href)}</span>"
                                                     for text, href in doc["contact"]) + "</div>")
    for heading, entries in doc["sections"]:
        out.append(f"<h2>{_html.escape(heading)}</h2>" + "".join(_entry_html(entry) for entry in entries))
    out.append("</body></html>")
    return "".join(out)


def _hyperlink(paragraph, text: str, href: str) -> None:
    """A clickable link in a Word paragraph (python-docx has no call for one)."""
    from docx.opc.constants import RELATIONSHIP_TYPE
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), paragraph.part.relate_to(href, RELATIONSHIP_TYPE.HYPERLINK, is_external=True))
    run, props, underline, words = (OxmlElement("w:r"), OxmlElement("w:rPr"), OxmlElement("w:u"),
                                    OxmlElement("w:t"))
    underline.set(qn("w:val"), "single")
    props.append(underline)
    words.text = text
    words.set(qn("xml:space"), "preserve")
    run.append(props)
    run.append(words)
    link.append(run)
    paragraph._p.append(link)


def docx(row, links: dict | None = None) -> bytes:
    """The version as a Word file: the same layout as the PDF, on the version's paper."""
    from docx import Document
    from docx.enum.text import WD_TAB_ALIGNMENT
    from docx.shared import Inches, Mm, Pt

    doc = layout(row, links)
    document = Document()
    page = document.sections[0]
    page.page_width, page.page_height = (Mm(210), Mm(297)) if is_a4(row.page_format) else (Inches(8.5), Inches(11))
    page.top_margin, page.bottom_margin = Inches(_MARGINS["top"]), Inches(_MARGINS["bottom"])
    page.left_margin, page.right_margin = Inches(_MARGINS["left"]), Inches(_MARGINS["right"])
    width = page.page_width - page.left_margin - page.right_margin
    normal = document.styles["Normal"]
    normal.font.name, normal.font.size = "Arial", Pt(10.5)
    normal.paragraph_format.space_after = Pt(2)

    def line(text: str = "", size: float | None = None, bold: bool = False, italic: bool = False):
        paragraph = document.add_paragraph()
        if text:
            run = paragraph.add_run(text)
            run.bold, run.italic = bold, italic
            if size:
                run.font.size = Pt(size)
        return paragraph

    if doc["name"]:
        line(doc["name"], size=18, bold=True)
    if doc["title"]:
        line(doc["title"], size=11.5)
    if doc["contact"]:
        paragraph = line()
        for index, (text, href) in enumerate(doc["contact"]):
            if index:
                paragraph.add_run(" | ")
            if href:
                _hyperlink(paragraph, text, href)
            else:
                paragraph.add_run(text)
    for heading, entries in doc["sections"]:
        line(heading.upper(), size=11, bold=True).paragraph_format.space_before = Pt(10)
        for entry in entries:
            if entry.get("head") or entry.get("side"):
                paragraph = line()
                paragraph.paragraph_format.tab_stops.add_tab_stop(width, WD_TAB_ALIGNMENT.RIGHT)
                if entry.get("href") and entry.get("head"):
                    _hyperlink(paragraph, entry["head"], entry["href"])
                elif entry.get("head"):
                    paragraph.add_run(entry["head"]).bold = True
                if entry.get("side"):
                    paragraph.add_run(f"\t{entry['side']}")
            if entry.get("sub"):
                line(entry["sub"], italic=True)
            if entry.get("text"):
                paragraph = line()
                if entry.get("label"):
                    paragraph.add_run(f"{entry['label']}: ").bold = True
                paragraph.add_run(entry["text"])
            for bullet in entry.get("bullets") or []:
                document.add_paragraph(bullet, style="List Bullet")
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()
