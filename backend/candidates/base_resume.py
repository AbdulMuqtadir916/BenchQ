"""Cleaning the base-résumé parser's reply (docs/team/resume-versioning.md §2; the parser handoff, Part 2 §8).

The model is not trusted with the values below, so code fixes them after the reply comes back: the headline (the
most recent role's title when the header prints none), the phone, the GitHub/LinkedIn links, the role dates, each
skill once, blank entries. `clean_reply` returns the response format's own keys and structure, every key present,
nothing added; that is what `resume_parses.parse` stores. `build_base_resume` is only a step inside it: its own keys
(`experience`, `school`, `contact_items`, `_layout`) are never stored or returned.

Ported from the handoff's reference implementation, with one BenchQ change: certifications are entries
`{name, issuer, date, detail}` like awards (resume-versioning.md §2), not strings. The fence and the tolerant JSON reader it names are
BenchQ's own (`backend/analyzer/prompt_fence.py`, `backend/analyzer/model_json.py`), the same code.
"""
import json
import re

BASE_SCHEMA_NAME = "base_resume"
NOT_PRINTED_KEY = "_not_printed"
LAYOUT_KEY = "_layout"
ATS_LAYOUT = "ats"
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
CERT_KEYS = ("name", "issuer", "date", "detail")
_ISO_DATE_RE = re.compile(r"^(\d{4})(?:-(\d{1,2}))?$")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE_RE = re.compile(r"\+?\(?\d[\d\s().-]{6,}\d")   # "(773) 250-3768" keeps its opening bracket
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_TECH_CANONICAL = (
    # languages and markup
    "JavaScript", "TypeScript", "CoffeeScript", "PowerShell", "MATLAB", "VBScript",
    # web and API frameworks
    "FastAPI", "NestJS", "SvelteKit", "AngularJS", "ASP.NET",
    "GraphQL", "WebSocket", "WebSockets", "OpenAPI", "Swagger",
    # ORMs, validation, async
    "SQLAlchemy", "TypeORM", "Pydantic", "Alembic", "Hibernate", "Mongoose", "Celery",
    # databases and stores
    "PostgreSQL", "MySQL", "MariaDB", "SQLite", "MongoDB", "DynamoDB", "CockroachDB",
    "ClickHouse", "InfluxDB", "Elasticsearch", "OpenSearch", "Firestore", "Firebase",
    "BigQuery", "Redshift", "Snowflake", "Databricks", "DataStax", "CassIO", "Neo4j",
    "Pinecone", "Weaviate", "Qdrant", "Milvus", "pgvector", "RabbitMQ", "ZooKeeper",
    # cloud and infrastructure
    "CloudFront", "CloudWatch", "CloudFormation", "SageMaker", "DocumentDB", "OpenShift",
    "Kubernetes", "Terraform", "Ansible", "ArgoCD", "CircleCI", "GitLab", "GitHub",
    "Bitbucket", "SonarQube", "PagerDuty", "Datadog", "Grafana", "Prometheus", "Nginx",
    # testing
    "JUnit", "TestNG", "Mockito", "JaCoCo", "Cypress", "Selenium", "Playwright", "Postman",
    # data and ML
    "NumPy", "SciPy", "XGBoost", "LightGBM", "CatBoost", "TensorFlow", "PyTorch",
    "Matplotlib", "JupyterLab", "MLflow", "Kubeflow", "OpenCV", "NLTK", "AutoML",
    # LLM and AI tooling
    "LangChain", "LangGraph", "LlamaIndex", "OpenAI", "OpenRouter",
    "Composio", "Docling", "DeepLearning.AI",
    # tools and platforms
    "IntelliJ", "PyCharm", "WebStorm", "DataGrip", "VMware", "VirtualBox", "PowerPoint",
    "SharePoint", "ServiceNow", "Salesforce", "QuickBooks", "WordPress", "Shopify",
    "TeamCity", "Bamboo", "Splunk", "Alteryx", "Informatica", "PowerBuilder",
    "AutoCAD", "SolidWorks", "Wireshark", "Nslookup", "Traceroute", "OAuth", "OpenID",
)
_TECH_VARIANTS = {
    "pytest": r"py[\s\-]*test",
    "unittest": r"unit[\s\-]*test(?!ing)",
    "pandas": r"pandas",
    "spaCy": r"spacy",
    "scikit-learn": r"scikit[\s\-]*learn|sci[\s\-]*kit[\s\-]*learn",
    "Node.js": r"node[\s.\-]*js",
    "Next.js": r"next[\s.\-]*js",
    "Nuxt.js": r"nuxt[\s.\-]*js",
    "Vue.js": r"vue[\s.\-]*js",
    "D3.js": r"d3[\s.\-]*js",
    "jQuery": r"j[\s\-]*query",
    "Socket.IO": r"socket[\s.\-]*io",
    ".NET": r"dot[\s\-]*net",
    "macOS": r"mac[\s\-]*os",
    "npm": r"npm",
    "dbt": r"dbt",
    "vLLM": r"vllm",
    "YAML": r"yaml",
    "JSON": r"json",
    "JWT": r"jwt",
    "gRPC": r"grpc",
    "CI/CD": r"ci[\s]*/[\s]*cd",
    # Closed-up compounds a case-boundary split cannot see, because they carry no
    # internal capital: "Firestore" reads as one token, so "Fire store" would survive.
    "Firestore": r"fire[\s\-]*store",
    "Firebase": r"fire[\s\-]*base",
    "Elasticsearch": r"elastic[\s\-]*search",
    "Databricks": r"data[\s\-]*bricks",
    "Datadog": r"data[\s\-]*dog",
    "Snowflake": r"snow[\s\-]*flake",
    "Salesforce": r"sales[\s\-]*force",
    "Wireshark": r"wire[\s\-]*shark",
    "Grafana": r"grafana",
    "Kubernetes": r"kubernetes|k8s",
    # Short forms a case-boundary split cannot derive. Order matters inside each
    # alternation: "postgres[\s-]*sql" has to be tried before bare "postgres", or
    # "Postgres SQL" matches the first word and leaves a stray "sql" behind.
    "PostgreSQL": r"postgres[\s\-]*sql|postgre[\s\-]*sql|postgresql|postgres",
    # Not when the résumé already prints the acronym next to it: "Google Cloud Platform
    # (GCP)" must not become "GCP (GCP)", which then fails to match the reply's "GCP (...)"
    # and gets restored beside it as a duplicate.
    "AWS": r"amazon[\s\-]*web[\s\-]*services(?!\s*\(\s*AWS\s*\))",
    "GCP": r"google[\s\-]*cloud[\s\-]*platform(?!\s*\(\s*GCP\s*\))",
}
_URLISH_RE = re.compile(
    r"\S*(?:https?://|www\.|@|\.com|\.org|\.net|\.io|\.ai|\.dev|\.co\b|\.in\b)\S*",
    re.IGNORECASE)
_FIRST_SECTION_RE = re.compile(r"(?im)^\W*(professional summary|summary|career objective|objective|profile|"
                               r"technical skills|skills|work experience|experience|education)\b")
_VENDOR_PREFIXES = ("apache", "aws", "amazon", "microsoft", "azure", "google", "oracle",
                    "ibm", "redhat", "atlassian", "adobe")
_SPELLED_ACRONYM_RE = re.compile(r"((?:\b[A-Za-z][A-Za-z0-9.+&/-]*\s+){1,5})\(([A-Za-z]{2,8})\)")
_DETAIL_GROUP_RE = re.compile(r"\s*\([^()]*\)\s*$")
_CLAIM_RES = (
    re.compile(r"\b[A-Z][A-Za-z]*[0-9][\w.\-]*\b"),
    re.compile(r"\b[A-Z]{2,8}\b"),
    re.compile(r"\b[A-Z][a-z]+(?:[A-Z][a-z]*)+\b"),
)

_TECH_COMMON_FIRST_WORD = {"fast", "open", "light", "deep", "big", "simple", "quick",
                           "smart", "cloud", "web", "spring", "swift", "express", "go"}
_TOKEN_RE = re.compile(r"[A-Z]+(?![a-z])|[A-Z][a-z]+|[a-z]+|[0-9]+")


def _tech_rules():
    """(compiled pattern, canonical spelling, guard) for every name worth repairing."""
    rules = []
    for name in _TECH_CANONICAL:
        parts = _TOKEN_RE.findall(name)
        if len(parts) < 2:
            continue                       # one token: nothing a split could have broken
        sep = r"[\s\-]*" if "." not in name else r"[\s.\-]*"
        rules.append((re.compile(r"\b" + sep.join(re.escape(p) for p in parts) + r"\b",
                                 re.IGNORECASE), name,
                      parts[0].lower() in _TECH_COMMON_FIRST_WORD))
    for name, pattern in _TECH_VARIANTS.items():
        first = (_TOKEN_RE.findall(name) or [""])[0].lower()
        rules.append((re.compile(r"\b(?:" + pattern + r")\b", re.IGNORECASE), name,
                      first in _TECH_COMMON_FIRST_WORD))
    return tuple(rules)


_TECH_RULES = _tech_rules()


def _text(value) -> str:
    """A model's string, stripped of control characters and outer whitespace."""
    return _CONTROL_RE.sub("", str(value or "")).strip()


def _profile_link(value: str, domain: str) -> dict | None:
    """A clickable contact item for a GitHub/LinkedIn address, or None when the value is no address (a bare "LinkedIn" label can't be made clickable)."""
    value = value.strip()
    if domain not in value.lower():
        return None
    url = value if re.match(r"^https?://", value, re.IGNORECASE) else f"https://{value}"
    text = re.sub(r"^https?://(www\.)?", "", value, flags=re.IGNORECASE).rstrip("/")
    return {"text": text, "url": url}


def canonicalize_tech(text: str) -> str:
    """A prose string with known technology names spelled the way a posting spells them.

    Never used on a URL or an email: "github.com/fastapi/fastapi" would come back recased
    and the link would no longer be the one the résumé printed. A match that had to cross a
    space or hyphen is only joined when it was capitalised as a name, so "a fast API
    response" stays English while "Fast API" becomes FastAPI.
    """
    if not text:
        return text

    # A link inside a bullet is an address, not prose: "github.com/foo/fastapi-demo" would
    # come back as "GitHub.com/foo/FastAPI-demo" and no longer resolve. The stored `url`
    # fields never reach this function, but a bullet may print one.
    if _URLISH_RE.search(text):
        out, last = [], 0
        for m in _URLISH_RE.finditer(text):
            out.append(canonicalize_tech(text[last:m.start()]))
            out.append(m.group())
            last = m.end()
        out.append(canonicalize_tech(text[last:]))
        return "".join(out)

    for pattern, canonical, ambiguous in _TECH_RULES:
        def swap(m, canonical=canonical, ambiguous=ambiguous):
            found = m.group()
            # A lowercase split of a name that starts with an ordinary English word is
            # prose, not a product: "a fast API response" must survive untouched.
            if ambiguous and re.search(r"[\s\-]", found) and not found[:1].isupper():
                return found
            return canonical
        text = pattern.sub(swap, text)
    return text


def _clean_bullets(bullets) -> list:
    return [t for t in (canonicalize_tech(_text(b))
                        for b in (bullets if isinstance(bullets, list) else [])) if t]


def _month_year(value) -> str:
    """'2021-05' → 'May 2021', '2021' → '2021', anything else → ''."""
    m = _ISO_DATE_RE.match(str(value or "").strip())
    if not m:
        return ""
    year, month = m.group(1), m.group(2)
    if month is None:
        return year
    return f"{_MONTHS[int(month) - 1]} {year}" if 1 <= int(month) <= 12 else ""


def _role_dates(role: dict) -> str:
    """'Mon YYYY – Mon YYYY' from the base's ISO start/end, or the single date on its own.

    A résumé that prints one date for a role is stating when it ended, so that date prints
    alone: "Jun 2025", never "– Jun 2025" or "Jun 2025 –". A dangling dash reads as missing
    information to a person and leaves a parser looking for the other half of a range.
    Returns '' only when there is no date at all, so the printed `dates` string still stands.
    """
    start = _month_year(role.get("start"))
    end = "Present" if role.get("current") else _month_year(role.get("end"))
    if start and end:
        return f"{start} – {end}"
    return end or start or ""


def _project_url(value: str) -> str:
    """A project link fit to click, or '' for a value that is no address."""
    value = value.strip()
    return value if re.match(r"^(https?://)?[\w-]+(\.[\w-]+)+(/\S*)?$", value, re.IGNORECASE) else ""


def _most_recent_title(experience: list) -> str:
    """The job title of the most recent role: an ongoing one, else the latest end date; the role
    listed first breaks a tie, since a résumé lists its newest role first."""
    def recency(i):
        role = experience[i]
        m = _ISO_DATE_RE.match(role.get("end") or "")
        ended = (int(m.group(1)), int(m.group(2) or 0)) if m else (0, 0)
        return (bool(role.get("current")), ended, -i)

    titled = [i for i, role in enumerate(experience) if role.get("title")]
    return experience[max(titled, key=recency)]["title"] if titled else ""


def _squash(text) -> str:
    """Lowercase letters and digits only, so 'U.S. Citizen' and 'US citizen' compare equal."""
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def _header_lines(text: str) -> str:
    """The document's header: what it prints before its first section heading, at most its first 12 lines."""
    first = _FIRST_SECTION_RE.search(text or "")
    top = (text or "")[:first.start()] if first else (text or "")
    return "\n".join(top.splitlines()[:12])


def _once(texts: list) -> list:
    """The non-empty texts, each once (ignoring case and spacing), in order."""
    out, seen = [], set()
    for text in texts:
        if text and _squash(text) not in seen:
            seen.add(_squash(text))
            out.append(text)
    return out


def _has_content(value) -> bool:
    """True when a field holds something a reader would see.

    Booleans do not count: `current: false` (or true) on an otherwise blank row is
    schema bookkeeping, not content, and letting it count would keep the row alive.
    """
    if isinstance(value, bool):
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple)):
        return any(_has_content(v) for v in value)
    if isinstance(value, dict):
        return any(_has_content(v) for v in value.values())
    return value is not None


def drop_empty_entries(data: dict) -> dict:
    """A copy of `data` with blank list entries and blank bullets removed.

    Strict-mode schemas have no way to say "this section is absent": every property
    is required, so a model with nothing to report may answer with one fully blank
    entry instead of an empty list. Templates guard sections with `{% if section %}`,
    and a one-element list is truthy however empty that element is, so the heading
    renders over nothing. Pruning here keeps that out of every template at once,
    and takes hand-added blank rows with it.
    """
    out = {}
    for key, value in (data or {}).items():
        if isinstance(value, list):
            kept = []
            for item in value:
                if not _has_content(item):
                    continue
                kept.append(drop_empty_entries(item) if isinstance(item, dict) else item)
            out[key] = kept
        else:
            out[key] = value
    return out


def _split_skills(value) -> list:
    """A skills line into its items, ignoring commas inside brackets.

    "AWS (ECS, Lambda, S3), Docker" is two skills, not five. Splitting blindly on every
    comma tore "AWS (ECS" away from "Lambda" and left "S3)" carrying a stray bracket, and
    the backfill then restored those fragments as orphans on their own lines — one tailored
    copy printed "Cloud: Google Cloud Platform (GCP) (Cloud Run" and "Containers & DevOps: IaC".
    """
    items, depth, current = [], 0, []
    for ch in str(value or ""):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            items.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    items.append("".join(current).strip())
    return [i for i in items if i]


def _names_in(value: str) -> list:
    """Every name a skills line holds, including the ones inside a group: "AWS (EC2, S3); GCP" → AWS, EC2, S3, GCP."""
    return [n.strip() for n in re.split(r"[,;()]", str(value or "")) if n.strip()]


def _drop_spelled_acronym(text: str) -> str:
    def cut(m):
        words = re.findall(r"[A-Za-z0-9]+", m.group(1))
        initials = "".join(w[0] for w in words).lower()
        # Only when the bracket really is the initials of the words in front of it, and
        # the ACRONYM is what survives: a reply writing the short form has to reduce to
        # the same key, and no alias table knows every long form a résumé might spell out.
        return m.group(2) + " " if initials.endswith(m.group(2).lower()) else m.group(0)
    return _SPELLED_ACRONYM_RE.sub(cut, text)


def _skill_key(skill: str) -> str:
    """One key per skill: used only for comparing, never for what gets printed."""
    named = canonicalize_tech(_drop_spelled_acronym(str(skill or "")))
    trimmed = _DETAIL_GROUP_RE.sub("", named).strip()
    return _squash(trimmed or named)


def _drop_vendor(key: str) -> str:
    for vendor in _VENDOR_PREFIXES:
        if key.startswith(vendor) and len(key) > len(vendor) + 2:
            return key[len(vendor):]
    return key


def _same_skill(a: str, b: str) -> bool:
    """Whether two spellings name the same skill.

    Canonicalise first, then compare exactly. This used to test whether one name contained
    the other, which quietly merged every skill whose name sits inside another: "SQL" is
    inside "PostgreSQL", "MySQL" and "SQL Server", so a résumé listing SQL lost all three —
    the same four terms on every run, whatever the posting asked for. Containment was a
    crude stand-in for "these are the same product"; canonicalize_tech() does that properly,
    from a curated list, so "Postgres" and "Postgres SQL" still meet "PostgreSQL" here.
    """
    ka, kb = _skill_key(a), _skill_key(b)
    if not ka or not kb:
        return False
    if ka == kb or ka == kb + "s" or kb == ka + "s":   # VLAN / VLANs, API / APIs
        return True
    return _drop_vendor(ka) == _drop_vendor(kb) and _drop_vendor(ka) != ""


def _each_skill_once(skills: dict) -> dict:
    """A base's skills with each skill listed once: a skill already named in an earlier category,
    or earlier in its own, is left out where it repeats. An item whose group would bring a new
    name with it stays, so no skill the résumé states is lost.
    """
    seen, out = [], {}
    for label, value in skills.items():
        kept = []
        for item in _split_skills(value):
            group = _names_in(item)[1:]
            repeated = any(_same_skill(item, s) for s in seen)
            if repeated and all(any(_same_skill(g, s) for s in seen) for g in group):
                continue
            kept.append(item)
            seen += _names_in(item)
        if kept:
            out[label] = ", ".join(kept)
    return out


def _skills_map(pairs) -> dict:
    """technical_skills pairs → the {category: "a, b"} map json_data stores."""
    out = {}
    for pair in pairs if isinstance(pairs, list) else []:
        if not isinstance(pair, dict):
            continue
        label = _text(pair.get("category"))
        value = pair.get("skills")
        if isinstance(value, list):
            value = ", ".join(str(v).strip() for v in value if str(v).strip())
        value = canonicalize_tech(_text(value))
        if label and value:
            out[label] = f"{out[label]}, {value}" if label in out else value
    return out


def _award_line(award: dict) -> str:
    """One printed line per award: name, who gave it, the date, then how competitive it was when the résumé says.
    "Dean's List, University of Texas, May 2018 (top 5% of 2,000 students)"."""
    line = ", ".join(_text(award.get(key)) for key in ("name", "issuer", "date") if _text(award.get(key)))
    detail = _text(award.get("detail"))
    return f"{line} ({detail})" if line and detail else line


def build_base_resume(reply: dict, source_text: str = "") -> dict:
    """A structuring reply → a base résumé's json_data: only the ATS sections, in order, marked for the ATS layout.

    Each role's printed date is formatted from its ISO pair ("Mon YYYY – Mon YYYY") and
    GitHub and LinkedIn become clickable only when the reply holds a real address. No
    bullet is trimmed here: the base résumé is the pool tailoring draws from, so it keeps
    everything the document states. With the document's text, a headline its header does not
    print is replaced by the most recent role's title, worked out here from the roles' dates.
    """
    reply = reply if isinstance(reply, dict) else {}
    head = reply.get("header") if isinstance(reply.get("header"), dict) else {}

    def field(key):
        return _text(head.get(key))

    # The value alone: a label the model kept ("Email: …") is not part of it.
    email = (_EMAIL_RE.search(field("email")) or [""])[0]
    phone_match = _PHONE_RE.search(field("phone"))
    phone = phone_match.group(0).strip() if phone_match else field("phone")
    github = _profile_link(field("github"), "github.")
    linkedin = _profile_link(field("linkedin"), "linkedin.")
    city, state, country = field("city"), field("state"), field("country")
    # Printed as the parts join ("Chicago, IL"); a reply in the older one-field shape still reads.
    location = ", ".join(p for p in (city, state, country) if p) or field("location")
    items = []
    # Location leads the contact line, as a résumé prints it: it is what a job board's
    # geographic filter reads, and the header is the only place it looks.
    if location:
        items.append({"text": location, "url": ""})
    if email:
        items.append({"text": email, "url": f"mailto:{email}"})
    if phone:
        items.append({"text": phone, "url": ""})
    if field("work_authorization"):
        items.append({"text": field("work_authorization"), "url": ""})
    items += [link for link in (github, linkedin) if link]
    header = {
        "name": field("name"),
        # The headline the résumé prints under the name; filled from the most recent role below when it prints none.
        "title": field("title"),
        "contact_items": items,
        # The split-out fields tailoring falls back on when the contact line lacks one.
        "contact": {"location": location, "city": city, "state": state, "country": country,
                    "email": email, "phone": phone,
                    "github": github["url"] if github else "",
                    "linkedin": linkedin["url"] if linkedin else ""},
    }

    experience = []
    for r in reply.get("work_experience") or []:
        if not isinstance(r, dict):
            continue
        role = {
            "company": _text(r.get("company")),
            "title": _text(r.get("job_title")),
            "location": _text(r.get("location")),
            "date": "",
            "start": str(r.get("start") or "").strip(),
            "end": str(r.get("end") or "").strip(),
            "current": bool(r.get("current")),
            "description": "",
            "bullets": _clean_bullets(r.get("bullets")),
        }
        role["date"] = _role_dates(role) or _text(r.get("dates"))
        experience.append(role)

    projects = []
    for p in reply.get("projects") or []:
        if not isinstance(p, dict):
            continue
        # The printed dates and stack ride in the description slot, one line under the name; they are
        # kept apart too, so a reader that wants the stack alone never has to split the printed line.
        dates, technologies = _text(p.get("dates")), canonicalize_tech(_text(p.get("technologies")))
        subtitle = " | ".join(s for s in (dates, technologies) if s)
        projects.append({
            "name": _text(p.get("name")),
            "url": _project_url(_text(p.get("url"))),
            "description": subtitle,
            "dates": dates,
            "technologies": technologies,
            "bullets": _clean_bullets(p.get("bullets")),
        })

    # An entry with no bullets is not experience: models have answered with a second,
    # bullet-less copy of a role, or parked the employer's description in one.
    experience = [r for r in experience if r["bullets"]]
    projects = [p for p in projects if p["bullets"]]

    # A résumé that prints no headline gets its most recent role's title, exactly as that role
    # states it: a model that recased it ("engineer" → "Engineer") gets the role's own spelling.
    # A model asked for "the most recent role" has been seen to pick the last one listed (the oldest), so when the
    # document's header does not print the headline the model gave, the code picks the role.
    most_recent = _most_recent_title(experience)
    printed = bool(source_text) and bool(header["title"]) and _squash(header["title"]) in _squash(_header_lines(source_text))
    if (not header["title"] or header["title"].casefold() == most_recent.casefold()
            or (source_text and not printed and most_recent)):
        header["title"] = most_recent

    education = [
        {"school": _text(e.get("institution")),
         "degree": _text(e.get("degree")),
         # The date as the document prints it ("Jun 2025", "Expected Dec 2026"), which
         # the templates put on the degree line rather than in a right-hand column.
         "years": _text(e.get("graduation_date")),
         "grade": _text(e.get("grade"))}
        for e in reply.get("education") or [] if isinstance(e, dict)
    ]

    certifications, seen = [], set()
    for cert in reply.get("certifications") or []:
        text = canonicalize_tech(_award_line(cert) if isinstance(cert, dict) else _text(cert))
        if text and _squash(text) not in seen:
            seen.add(_squash(text))
            certifications.append(text)

    languages = _once([_text(language) for language in reply.get("languages") or []])
    base = drop_empty_entries({
        "header": header,
        "summary": canonicalize_tech(_text(reply.get("professional_summary"))),
        "skills": _each_skill_once(_skills_map(reply.get("technical_skills"))),
        "experience": experience,
        "projects": projects,
        "education": education,
        "awards": _once([_award_line(a) for a in reply.get("awards") or [] if isinstance(a, dict)]),
        "certifications": certifications,
        "languages": languages,
        LAYOUT_KEY: ATS_LAYOUT,
    })
    if languages:
        base[NOT_PRINTED_KEY] = ["languages"]
    return base


def clean_reply(reply: dict, source_text: str = "") -> dict:
    """The reply with build_base_resume's fixes, in the response format's own shape: the same keys, every key
    present, nothing added. This is what resume_parses.parse stores."""
    base = build_base_resume(reply, source_text=source_text)
    reply = reply if isinstance(reply, dict) else {}
    head = reply.get("header") if isinstance(reply.get("header"), dict) else {}
    contact = base["header"].get("contact") or {}
    # Awards stay structured; a repeat is the same printed line, ignoring case and spacing.
    awards, seen = [], set()
    for a in reply.get("awards") or []:
        if not isinstance(a, dict) or not _award_line(a) or _squash(_award_line(a)) in seen:
            continue
        seen.add(_squash(_award_line(a)))
        awards.append({k: _text(a.get(k)) for k in ("name", "issuer", "date", "detail")})
    # Certifications are entries too (a BenchQ change to the handoff, 2026-11-01): with one string per certification,
    # the model glued the description to the name. Each once by name and issuer; tech names respelled.
    certifications, seen = [], set()
    for c in reply.get("certifications") or []:
        cert = ({k: canonicalize_tech(_text(c.get(k))) for k in CERT_KEYS} if isinstance(c, dict)
                else dict.fromkeys(CERT_KEYS, "") | {"name": canonicalize_tech(_text(c))})    # the older string shape
        key = _squash(cert["name"] + cert["issuer"])
        if not cert["name"] or key in seen:
            continue
        seen.add(key)
        certifications.append(cert)
    return {
        "header": {"name": base["header"].get("name", ""), "title": base["header"].get("title", ""),
                   **{k: contact.get(k, "") for k in ("city", "state", "country", "email", "phone")},
                   "work_authorization": _text(head.get("work_authorization")),
                   "github": contact.get("github", ""), "linkedin": contact.get("linkedin", "")},
        "professional_summary": base.get("summary", ""),
        "technical_skills": [{"category": c, "skills": s} for c, s in (base.get("skills") or {}).items()],
        "work_experience": [{"job_title": r["title"], "company": r["company"], "location": r["location"],
                             "dates": r["date"], "start": r["start"], "end": r["end"], "current": r["current"],
                             "bullets": r["bullets"]} for r in base.get("experience") or []],
        "projects": [{k: p.get(k, "") for k in ("name", "url", "dates", "technologies")} | {"bullets": p["bullets"]}
                     for p in base.get("projects") or []],
        "education": [{"degree": e.get("degree", ""), "institution": e.get("school", ""),
                       "graduation_date": e.get("years", ""), "grade": e.get("grade", "")}
                      for e in base.get("education") or []],
        "certifications": certifications,
        "awards": awards,
        "languages": base.get("languages") or [],
    }


def dropped_source_terms(structured: dict, source_text: str) -> list:
    """Technical terms the source document names that the structured résumé no longer holds.

    The structuring step has no pool to fall back on — the document is the pool — so a term
    lost here is lost for good, and tailoring can never put it back. It happens when a skills
    line is written as a sentence and only its subject survives: "Ping, Traceroute, and
    Nslookup for connectivity, latency and DNS diagnostics" came through without DNS, a term
    the posting asked for by name. Reporting only, so a human sees what the document gave up.
    """
    kept = _squash(json.dumps(structured, ensure_ascii=False))
    out, seen = [], set()
    for line in str(source_text or "").splitlines():
        letters = [c for c in line if c.isalpha()]
        # A heading is set in capitals, so its words would read as acronyms.
        if not letters or sum(c.isupper() for c in letters) / len(letters) > 0.9:
            continue
        for pattern in _CLAIM_RES:
            for term in pattern.findall(line):
                key = _squash(term)
                if len(key) >= 2 and key not in kept and key not in seen:
                    seen.add(key)
                    out.append(term)
    return out
