"""What the ATS match reads once per résumé, and the small vocabularies it needs: certifications, industries and the
boilerplate a posting carries (benefits, equal-opportunity notices) that says nothing about the job.

The résumé is the parsed one (Resume.json_data; in BenchQ, the base résumé the tailor reads). Everything here is plain
code: the technologies its roles name, the ones only its skills list names, its titles, its years from the roles'
dates, its highest degree, and its text with "## " headings.
"""
import re
from dataclasses import dataclass, field
from datetime import date

from backend.match.keyword_match import skills_in
from backend.match.match_words import degree_level_of_entry, folded_words
from backend.match.job_quality import split_title
from backend.match.main_skills import technologies, used_in_roles

_ISO_MONTH = re.compile(r"^(\d{4})(?:-(\d{1,2}))?")

# A family a posting asks for by name is shown by any member a résumé names (ATS rules 10.4; the focused copy's
# checks use the same lists). The keys and members are the skills dictionary's standard names.
_RELATIONAL = frozenset({"PostgreSQL", "MySQL", "Oracle", "SQL Server", "mariadb", "sqlite", "amazon-aurora", "Oracle Database"})
FAMILIES = {
    "NoSQL": frozenset({"MongoDB", "DynamoDB", "Cassandra", "Redis", "Elasticsearch", "google-cloud-firestore", "hbase",
                        "couchbase", "neo4j", "Azure Cosmos DB", "Amazon DynamoDB", "Apache Cassandra"}),
    "Relational Databases": _RELATIONAL, "RDBMS": _RELATIONAL, "SQL Databases": _RELATIONAL,
}


def family_members_held(name: str, held: frozenset) -> bool:
    """Whether `name` is a family (NoSQL, RDBMS) and `held` names one of its members."""
    return bool(FAMILIES.get(name) and FAMILIES[name] & held)


# Certifications a posting names: each pattern's match is the certification's name as the posting writes it.
_CERT_PATTERNS = [re.compile(p, re.I) for p in (
    r"\baws certified[\w\s\-–]*?(?:associate|professional|specialty|practitioner|engineer|architect|developer)\b",
    r"\b(?:az|dp|ai|sc|ms|pl|mb|md)-\d{3}\b",
    r"\b(?:microsoft|azure) certified[\w\s\-:]*?(?:associate|expert|fundamentals|engineer|architect|administrator"
    r"|developer)\b",
    r"\bgoogle (?:cloud )?(?:professional|associate) [\w\s]*?(?:engineer|architect|developer|analyst)\b",
    r"\b(?:pmp|capm|csm|psm ?i{1,2}|pspo|cissp|cism|cisa|ceh|oscp|ccna|ccnp|ccie|cka|ckad|cks|itil|togaf|ocp|ocpjp"
    r"|ocajp|rhce|rhcsa|snowpro|safe (?:agilist|practitioner)|security\+|network\+|comptia [a-z]+\+?)\b",
    r"\b(?:lean )?six sigma(?: (?:green|black|yellow) belt)?\b",
    r"\b(?:tableau|power bi|salesforce|databricks|snowflake|terraform|hashicorp|kubernetes|scrum|servicenow|sap"
    r"|oracle|cisco|red hat|vmware|confluent|mulesoft|pega|workday) certified[\w\s\-]{0,40}?"
    r"(?:professional|associate|engineer|architect|developer|administrator|analyst|master|practitioner|specialist"
    r"|expert|consultant|\b)",
    r"\bcertified (?:[\w\-]+ ){1,5}?(?:professional|associate|engineer|architect|developer|administrator|analyst"
    r"|master|practitioner|specialist|expert|consultant|auditor|manager)\b",
    # Healthcare and federal: Epic's module certifications, DoD 8570/8140, IIBA and PMI credentials.
    r"\bepic (?:[\w/]+ ){0,2}?certif\w*(?: in (?:[\w/]+(?:, | and | or )?){1,5})?",
    r"\bcertif\w* (?:[\w/]+ ){0,3}?(?:cogito|clarity|caboodle|hyperspace|radar)\b(?: data model(?:ing|s)?)?",
    r"\b(?:cogito|clarity|caboodle)(?:/(?:cogito|clarity|caboodle))* certif\w*",
    r"\bdod ?8(?:570|140)(?:\.\d+)?\b", r"\b(?:cbap|ccba|pmi-pba|pmi-acp|ecba|iiba)\b",
)]
# Industries and fields a posting may ask experience in, and the words that name each. A bare word that also has an
# everyday or benefits meaning ("insurance", "travel", "media", "energy", "federal", "telecommute") is not enough: it
# must come with a word that makes it the industry ("insurance carrier", "travel industry", "federal agency").
INDUSTRIES = {
    "healthcare": r"\bhealth ?care\b(?!\s+(?:benefits?|coverage|plans?|insurance|options|package|reimbursement|savings|"
                  r"spending|account))|\bhealth ?(?:tech|systems?)\b|\bhospitals?\b|\bclinical\b|\bhipaa\b|\bmedicaid\b"
                  r"|\bmedicare\b|\bpharma|\blife sciences\b|(?-i:\bEpic\b)|\bhl7\b|\bfhir\b|\bpatients\b"
                  r"|\bpatient (?:care|data|records?|experience|outcomes|safety)\b",
    "financial services": r"\bfinancial services\b|\bfin ?tech\b|\bbanks?\b|\bbanking\b|\bcapital markets\b"
                          r"|\btrading\b(?!\s+partners?)|\bwealth management\b|\basset management\b|\bbrokerage\b"
                          r"|\blending\b|\bmortgages?\b|\bcredit cards?\b|\binvestment bank",
    "insurance": r"\binsurance (?:industry|company|companies|carriers?|domain|clients?|sector|products?|platform|business"
                 r"|agency|brokers?|claims|policies|policy administration)\b|\binsurers?\b|\bp&c\b"
                 r"|\bproperty (?:and|&) casualty\b|\bactuar|\bclaims (?:processing|management|systems?|adjust)"
                 r"|\bunderwriting\b|\bguidewire\b|\bduck ?creek\b|\breinsurance\b",
    "payments": r"\bpayments? (?:industry|processing|processors?|platforms?|networks?|gateways?|systems?|company|companies"
                r"|domain|infrastructure|rails)\b|\bcard (?:processing|networks?|issuing)\b|\bpci[- ]dss\b"
                r"|\bmerchant acquir|\bacquirers?\b",
    "retail / e-commerce": r"\be-?commerce\b|\bretail(?:ers?)?\b|\bomnichannel\b|\bpoint of sale\b|\bpos systems?\b",
    "telecom": r"\btelecom(?:s|munications?)?\b|\btelco\b|\b5g\b|\bwireless carriers?\b",
    "government": r"\bgovernment (?:agenc(?:y|ies)|clients?|customers?|sector|contracts?|contractors?|programs?|services"
                  r"|entities)\b|\bfederal (?:government|agenc(?:y|ies)|clients?|customers?|contracts?|contractors?"
                  r"|sector|programs?|civilian)\b|\bpublic sector\b|\bdod\b|\bdepartment of (?:defense|energy|homeland"
                  r"|veterans|state|justice|labor|transportation|health|the (?:army|navy|air force|treasury|interior))\b"
                  r"|\bstate (?:agenc(?:y|ies)|government)\b|\bfedramp\b|\bcommonwealth of\b",
    "manufacturing": r"\bmanufactur|\bindustrial (?:automation|iot|engineering|equipment|companies|clients)\b"
                     r"|\bplant floor\b|\bmes\b|\bscada\b|\bfactor(?:y|ies)\b",
    "supply chain / logistics": r"\bsupply chain\b|\blogistics\b|\bwarehouse management\b|\bwms\b|\bfreight\b",
    "energy / utilities": r"\benergy (?:industry|sector|company|companies|trading|markets?|management|storage|efficiency)\b"
                          r"|\butilit(?:y|ies) (?:industry|sector|company|companies|customers|clients)\b"
                          r"|\belectric(?:al)? utilit|\boil (?:and|&) gas\b|\brenewables?\b"
                          r"|\bpower (?:grid|generation|plants?)\b|\bsolar\b",
    "education": r"\bhigher education\b|\bed ?tech\b|\bk-12\b|\blearning management\b|\bschool districts?\b",
    "media / advertising": r"\bad ?tech\b|\bmedia (?:company|companies|industry|agency|brands?)\b"
                           r"|\bmedia (?:and|&) entertainment\b|\bdigital media\b|\badvertising\b|\bvideo streaming\b"
                           r"|\bstreaming (?:service|media)\b|\bpublishing (?:industry|company|house)\b",
    "automotive": r"\bautomotive\b|\bvehicles?\b|\bautomakers?\b",
    "aerospace / defense": r"\baerospace\b|\bdefen[cs]e (?:industry|contractors?|sector|programs?|systems|department"
                           r"|clients?|customers?|agenc(?:y|ies))\b|\bdefen[cs]e and (?:aerospace|intelligence)\b"
                           r"|\bavionics\b",
    "real estate": r"\breal estate\b|\bproperty management\b|\bproptech\b",
    "travel / hospitality": r"\bhospitality\b|\btravel (?:industry|company|companies|technology|booking|agency|sector)\b"
                            r"|\bairlines?\b|\bhotels?\b|\bcruise lines?\b",
    "life insurance / annuities": r"\bannuit|\blife insurance (?:industry|company|companies|carriers?|products?|policies"
                                  r"|domain|business)\b|\blife and annuit",
    "human resources": r"\bhr tech\b|\bhuman resources (?:technology|systems?|software|domain|industry)\b|\bhris\b"
                       r"|\bpayroll (?:systems?|software|processing|platform|domain|company)\b|(?-i:\bWorkday\b)|\bhcm\b",
}
_INDUSTRY_RES = {name: re.compile(pattern, re.I) for name, pattern in INDUSTRIES.items()}

# A sentence of benefits, an equal-opportunity notice or hiring process: it names no requirement, but its words
# ("dental insurance", "federal, state and local laws", "health plan") look like industries and soft skills.
BOILERPLATE = re.compile(
    r"equal (?:employment )?opportunit|\beeo\b|regardless of|without regard to|protected (?:veteran|class|status)"
    r"|reasonable accommodation|\b401\s*\(?k\)?|paid time off|\bpto\b|\bdental\b|\bvision (?:insurance|coverage|plans?)"
    r"|health (?:insurance|benefits|plans?|coverage)|benefits? (?:package|include|offered|program)|e-verify"
    r"|federal, state,? (?:and|or) local|pay (?:range|transparency)|(?:compensation|salary) range|base salary"
    r"|background (?:check|investigation)|drug (?:test|screen)|privacy (?:notice|policy)|recruiting scams?"
    r"|posing as recruiters|affirmative action", re.I)
# A heading that starts a section of benefits or notices; the section ends at the next heading.
_BOILERPLATE_HEADING = re.compile(
    r"(?im)^[\s*#•\-]*(?:benefits|perks|what we offer|our benefits|compensation (?:and|&) benefits|total rewards"
    r"|equal (?:employment )?opportunity|eeo statement|pay transparency|disclaimer)\b[^\n]{0,40}$")
_ANY_HEADING = re.compile(r"^[\s*#•\-]*[A-Z][^\n.!?]{0,60}:?\s*$")


def without_boilerplate(text: str) -> str:
    """The posting without its benefits and equal-opportunity sections and sentences."""
    kept, skipping = [], False
    for line in (text or "").splitlines():
        if _BOILERPLATE_HEADING.match(line):
            skipping = True
            continue
        if skipping and _ANY_HEADING.match(line) and len(line.split()) <= 6:
            skipping = False
        if skipping:
            continue
        kept.append(" ".join(s for s in re.split(r"(?<=[.!?;])\s+", line) if not BOILERPLATE.search(s)))
    return "\n".join(kept)


def certifications_asked(lines: list) -> list:
    """[(name, preferred)] for each certification the posting's lines name, once each; `lines` are (text, preferred)."""
    found, seen = [], set()
    for text, preferred in lines:
        for pattern in _CERT_PATTERNS:
            for match in pattern.finditer(text):
                name = re.sub(r"\s+", " ", match.group(0).strip(" .,;:-"))
                key = " ".join(folded_words(name))
                if len(key) < 3 or key in seen:
                    continue
                seen.add(key)
                found.append((name, bool(preferred)))
    return found


def industries_in(text: str) -> list:
    """The industries the text names, in INDUSTRIES order."""
    return [name for name, pattern in _INDUSTRY_RES.items() if pattern.search(text or "")]


# ── The résumé, read once ───────────────────────────────────────────────────────

def _month_index(value) -> int | None:
    match = _ISO_MONTH.match(str(value or "").strip())
    if not match:
        return None
    year, month = int(match.group(1)), int(match.group(2) or 1)
    return year * 12 + min(max(month, 1), 12) - 1


def years_from_dates(resume: dict, today: date | None = None) -> float | None:
    """The years the roles cover by their ISO start/end dates, each month counted once; None with no dated role."""
    today = today or date.today()
    now = today.year * 12 + today.month - 1
    months = set()
    for role in (resume or {}).get("experience") or []:
        if not isinstance(role, dict):
            continue
        first = _month_index(role.get("start"))
        if first is None:
            continue
        last = now if role.get("current") else _month_index(role.get("end"))
        if last is None or last < first:
            last = first
        months.update(range(first, min(last, now) + 1))
    return round(len(months) / 12, 1) if months else None


def _entry_text(entry) -> str:
    """A certification or award as one line: a string as it is, an entry {name, issuer, date} as its parts."""
    if isinstance(entry, dict):
        return " — ".join(str(entry.get(k) or "").strip() for k in ("name", "issuer", "date") if entry.get(k))
    return str(entry or "")


def resume_as_text(resume: dict) -> str:
    """The résumé as plain text with "## " section headings."""
    resume = resume or {}
    header = resume.get("header") if isinstance(resume.get("header"), dict) else {}
    contact = header.get("contact") if isinstance(header.get("contact"), dict) else {}
    parts = [str(header.get("name") or "")]
    if header.get("title"):
        parts.append(str(header["title"]))
    items = [str(i.get("text") or "") for i in header.get("contact_items") or [] if isinstance(i, dict)]
    items += [str(contact.get(k) or "") for k in ("email", "phone", "location") if contact.get(k)]
    if items:
        parts.append(" | ".join(dict.fromkeys(i for i in items if i)))
    if resume.get("summary"):
        parts += ["## Summary", str(resume["summary"])]
    roles = [r for r in resume.get("experience") or [] if isinstance(r, dict)]
    if roles:
        parts.append("## Experience")
        for role in roles:
            dates = role.get("date") or role.get("dates") or ""
            parts.append(f"{role.get('title', '')} at {role.get('company', '')} ({dates})".strip(" ()"))
            if role.get("description"):
                parts.append(str(role["description"]))
            parts += [f"- {b}" for b in role.get("bullets") or []]
    projects = [p for p in resume.get("projects") or [] if isinstance(p, dict)]
    if projects:
        parts.append("## Projects")
        for project in projects:
            parts.append(str(project.get("name") or ""))
            if project.get("technologies"):
                parts.append(str(project["technologies"]))
            parts += [f"- {b}" for b in project.get("bullets") or []]
    skills = resume.get("skills") or {}
    if skills:
        parts.append("## Skills")
        parts += [f"{label}: {', '.join(v) if isinstance(v, list) else v}" for label, v in skills.items()]
    education = [e for e in resume.get("education") or [] if isinstance(e, dict)]
    if education:
        parts.append("## Education")
        parts += [" | ".join(str(e.get(k) or "") for k in ("degree", "school", "institution", "years",
                                                           "graduation_date") if e.get(k)) for e in education]
    certifications = [_entry_text(c) for c in resume.get("certifications") or []]
    if any(certifications):
        parts += ["## Certifications", *[c for c in certifications if c]]
    return "\n".join(p for p in parts if p is not None)


def degree_held(resume: dict) -> int:
    """The highest degree level (1 Associate … 4 Ph.D.) the résumé's education entries name; 0 when none does."""
    return max((degree_level_of_entry(str(e.get("degree") or "")) for e in (resume or {}).get("education") or []
                if isinstance(e, dict)), default=0)


@dataclass
class ResumeFacts:
    """Everything the match reads from one résumé, computed once and reused across its hundred jobs."""
    resume: dict
    text: str = ""
    used: frozenset = frozenset()          # technologies a role or project names (standard names)
    listed: frozenset = frozenset()        # technologies only the skills list names
    titles: list = field(default_factory=list)
    latest_role: str = ""
    years: float | None = None
    degree: int = 0                        # the highest degree level its education names
    words: list = field(default_factory=list)   # the text's folded words, for literal term matching
    mentions: dict = field(default_factory=dict)  # skills_in(text): every dictionary keyword the résumé writes
    industries: frozenset = frozenset()

    @classmethod
    def read(cls, resume: dict, today: date | None = None) -> "ResumeFacts":
        resume = resume or {}
        text = resume_as_text(resume)
        used = used_in_roles(resume)
        skills_text = " ".join(", ".join(v) if isinstance(v, list) else str(v) for v in (resume.get("skills") or {}).values())
        header = resume.get("header") if isinstance(resume.get("header"), dict) else {}
        roles = [r for r in resume.get("experience") or [] if isinstance(r, dict)]
        # A slash headline ("DevOps Engineer / SRE") is two titles, as the search reads it (job_quality.split_title).
        titles = list(dict.fromkeys(one for t in [str(header.get("title") or "")] + [str(r.get("title") or "")
                                                                                       for r in roles[:1]]
                                    for one in split_title(t) if one))
        return cls(resume=resume, text=text, used=used, listed=frozenset(technologies(skills_text)) - used,
                   titles=titles, latest_role=str(roles[0].get("title") or "") if roles else "",
                   years=years_from_dates(resume, today), degree=degree_held(resume), words=folded_words(text),
                   mentions=skills_in(text), industries=frozenset(industries_in(text)))
