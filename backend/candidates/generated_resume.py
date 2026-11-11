"""A résumé file made from a candidate's own details, for candidates that have no file (07 Q58).

BenchQ onboards a candidate only with their résumé (Abdul, 2026-11-06). The demo seed's candidates, and any made before
that rule from the form alone, get this instead: a one-page PDF of what was entered, kept like an upload
(`resume_parses`, an UPLOAD base). No AI is involved; the parse is written from the same details.
"""
import hashlib

PDF_MIME = "application/pdf"


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def pdf(lines: list[str]) -> bytes:
    """A minimal one-page PDF (Helvetica, one line each)."""
    body = "BT /F1 11 Tf 50 750 Td 15 TL " + " ".join(f"({_escape(line)}) '" for line in lines if line) + " ET"
    objects = ["<< /Type /Catalog /Pages 2 0 R >>",
               "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> "
               "/Contents 4 0 R >>",
               f"<< /Length {len(body.encode('latin-1', 'replace'))} >>\nstream\n{body}\nendstream",
               "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = b"%PDF-1.4\n", []
    for number, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{obj}\nendobj\n".encode("latin-1", "replace")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def from_details(*, name: str, title: str | None, email: str | None, phone: str | None, linkedin: str | None,
                 city: str | None, state: str | None, country: str | None, work_authorization: str | None,
                 summary: str | None = None, skills: list[str] | None = None, salt: str = "") -> tuple[bytes, dict]:
    """(the PDF, its parse in the parser's format). `salt` keeps two such files of one candidate apart."""
    location = ", ".join(p for p in (city, state, country) if p)
    lines = [name, title or "", " | ".join(p for p in (email, phone, linkedin, location) if p),
             f"Work authorization: {work_authorization}" if work_authorization else "",
             f"Summary: {summary}" if summary else "", f"Skills: {', '.join(skills)}" if skills else "",
             f"Generated from the candidate's details {salt}".strip()]
    parse = {"header": {"name": name, "title": title or "", "city": city or "", "state": state or "",
                        "country": country or "", "email": email or "", "phone": phone or "",
                        "work_authorization": work_authorization or "", "github": "", "linkedin": linkedin or ""},
             "professional_summary": summary or "",
             "technical_skills": [{"category": "", "skills": ", ".join(skills)}] if skills else [],
             "work_experience": [], "projects": [], "education": [], "certifications": [], "awards": [],
             "languages": []}
    return pdf(lines), parse


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
