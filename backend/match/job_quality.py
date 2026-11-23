"""Job-quality rules every search shares: search titles split into single titles, jobs from another kind of role,
second-hand copy sites and known junk posters.

One place for the lists, so a multi-company deployment maintains them once (and can later layer per-company
additions on top). Plain data and plain functions: no model, no network, no per-candidate state. The lists come
from the 2026-11-08 board study (1,031 jobs over 8 résumés) and the JSearch quality check that followed.
"""
import re
from urllib.parse import urlparse

# ── Search titles ────────────────────────────────────────────────────────────

# Slash-joined pairs that name one thing; a title holding one is not split there.
ONE_TERM = {"ai/ml", "ml/ai", "ci/cd", "ui/ux", "ux/ui", "pl/sql", "tcp/ip", "a/b", "c/c++", "i/o", "ar/vr", "r&d"}
MOST_TITLES_FROM_ONE = 4
# Words that make a phrase a job title: "Generative AI / ML Engineer" means "Generative AI Engineer" and "ML Engineer".
_ROLE_WORD = re.compile(r"(engineer|developer|analyst|scientist|architect|administrator|admin|manager|consultant|"
                        r"specialist|designer|lead|programmer|tester|owner|officer|director)s?$", re.I)


def _alternatives(chunk: str) -> list:
    """One "|"-free chunk → its single titles: "GenAI / LLM Engineer" → ["GenAI Engineer", "LLM Engineer"]."""
    if "/" not in chunk or chunk.lower().replace(" ", "") in ONE_TERM:
        return [chunk]
    if re.search(r"\s/\s", chunk):                      # spaced: "GenAI / LLM Engineer", "Data Engineer / Data Scientist"
        left, right = (s.strip() for s in re.split(r"\s+/\s+", chunk, maxsplit=1))
        lw, rw = left.split(), right.split()
        if not lw or not rw:
            return [chunk]
        if len(lw) >= 2 and len(rw) >= 2:               # two titles; the left borrows the right's role word if it has none
            if not _ROLE_WORD.search(lw[-1]) and _ROLE_WORD.search(rw[-1]):
                left = f"{left} {rw[-1]}"
            return [left, *_alternatives(right)]
        if len(lw) == 1:                                # "GenAI / LLM Engineer": the left word swaps for the first
            return [" ".join([lw[0], *rw[1:]]), *_alternatives(right)]
        return [left, " ".join([*lw[:-1], rw[0]])]      # "Backend Developer / Lead": the right word swaps for the last
    words = chunk.split()                               # unspaced: "GenAI/LLM Engineer"
    for i, word in enumerate(words):
        if "/" in word and word.lower() not in ONE_TERM:
            parts = [p for p in word.split("/") if p]
            return [" ".join([*words[:i], p, *words[i + 1:]]) for p in parts]
    return [chunk]


def split_title(title: str) -> list:
    """A title as single search titles: "|" separates titles, a slash separates alternatives; at most four."""
    out = []
    for chunk in re.split(r"\s*\|\s*", title or ""):
        for one in _alternatives(re.sub(r"\s+", " ", chunk).strip()):
            if one and one.casefold() not in {o.casefold() for o in out}:
                out.append(one)
    return out[:MOST_TITLES_FROM_ONE] or ([title.strip()] if title and title.strip() else [])


# ── Another kind of role ─────────────────────────────────────────────────────

# A job whose title names one of these, for a candidate whose titles do not, is a different role however many of the
# candidate's words it shares ("QA Automation Engineer - GenAI / LLM Testing" for a GenAI engineer).
OTHER_ROLES = {
    "QA/testing": re.compile(r"\b(qa|quality assurance|quality engineer|sdet|tester|test automation|"
                             r"automation tester|test engineer|testing)\b", re.I),
    # Gigs writing or grading answers to train a model ("Solar Design Engineer AI Reviewer", "Java Developer - AI
    # Trainer"): the 2026-11-08 fit test found OpenTrain AI's passing the title check for an AI Engineer.
    "AI training": re.compile(r"\b(?:ai|llm|model|rlhf)\s+(?:trainer|tutor|reviewer|rater|evaluator|annotator|"
                              r"training\s+(?:specialist|expert|contributor))s?\b|\bdata\s+annotat(?:or|ion)\b|"
                              r"\b(?:ai|llm)\s+training\b(?!\s+(?:infrastructure|platform|systems?|pipelines?|frameworks?|clusters?|"
                              r"engineer|scientist|research))", re.I),
}


def other_role(job_title: str, candidate_titles) -> str:
    """The kind of role the job title names that none of the candidate's titles does; "" when none."""
    for name, pattern in OTHER_ROLES.items():
        if pattern.search(job_title or "") and not any(pattern.search(t or "") for t in candidate_titles):
            return name
    return ""


# ── What kind of role a title names, and which company a name is ─────────────

# Groups of words naming the KIND of job. "Business Development Representative" shares "Business" with "Business
# Analyst" but is a different kind of job; "Developer", "Engineer" and "Programmer" are one kind.
ROLE_KINDS = {
    "engineer": ("engineer", "developer", "programmer", "coder", "swe", "sde", "devops"),
    "analyst": ("analyst",), "architect": ("architect",), "scientist": ("scientist", "researcher"),
    "manager": ("manager", "director", "vp", "head"), "administrator": ("administrator", "admin", "sysadmin"),
    "consultant": ("consultant",), "specialist": ("specialist",), "designer": ("designer",),
    "recruiter": ("recruiter", "sourcer"), "sales": ("representative", "rep", "sdr", "bdr", "salesperson", "sales",
                                                    "partner", "executive", "account"),
    "technician": ("technician",), "accountant": ("accountant",), "coordinator": ("coordinator",),
}
_KIND_OF = {word: kind for kind, words in ROLE_KINDS.items() for word in words}


def role_kinds(title: str) -> set:
    """The kinds of role a title names ("Sr. Data Engineer" -> {"engineer"}); empty when it names none."""
    return {_KIND_OF[w] for w in re.findall(r"[a-z]+", (title or "").lower()) if w in _KIND_OF}


_COMPANY_SUFFIXES = {"inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "technologies",
                     "technology", "tech", "group", "holdings", "solutions", "services", "systems", "the", "plc",
                     "lp", "llp", "gmbh"}


def company_key(name: str) -> str:
    """A company's name without the words companies add or drop ("Akamai Technologies, Inc." == "Akamai")."""
    words = [w for w in re.findall(r"[a-z0-9]+", (name or "").lower()) if w not in _COMPANY_SUFFIXES]
    return "".join(words) or re.sub(r"\W+", "", (name or "").lower())


# ── Second-hand copies and junk posters ──────────────────────────────────────

# Sites that repost other boards' jobs with a rewritten summary or a stale copy (closed listings, shifted dates).
COPY_SITES = ("jobleads", "trabajo.org", "learn4good", "jooble", "remotejobs.dedyn.io", "remoterocketship", "devgigs")
# Posters whose listings are bait or near-duplicates rather than a job: entry-level "training" programmes, job feeds
# posting under a feed's name, data-collection "gigs".
JUNK_POSTERS = ("synergisticit", "yo ai labs", "remote quest jobs", "tech jobs", "dice us sales demo account")
# Places an apply link is worth sending a BDE to besides the employer's own site.
MAIN_BOARDS = ("linkedin.com", "indeed.com", "ziprecruiter.com", "dice.com", "monster.com", "glassdoor.com")


def host(url: str) -> str:
    return urlparse(url or "").netloc.lower().removeprefix("www.")


def is_copy_site(url_or_name: str) -> bool:
    text = (url_or_name or "").lower()
    return any(site in text for site in COPY_SITES)


def is_junk_poster(company: str) -> bool:
    name = re.sub(r"\s+", " ", (company or "").lower()).strip()
    return name.rstrip(".,") in JUNK_POSTERS          # the exact name: "Tech Jobs", not "Tech Jobs Fair Inc"


def is_main_board(url: str) -> bool:
    return any(host(url) == board or host(url).endswith("." + board) for board in MAIN_BOARDS)


# ── Jobs in another country ──────────────────────────────────────────────────

# A region or country named in a posting's title or location ("Full Remote - Portugal", "San José, Costa Rica"), with
# the country it means ("" for a region outside every single country), and currencies a description pays in.
_ABROAD = {"latam": "", "latin america": "", "emea": "", "apac": "", "europe": "", "eu only": "", "portugal": "PT",
           "poland": "PL", "spain": "ES", "germany": "DE", "france": "FR", "netherlands": "NL", "romania": "RO",
           "ukraine": "UA", "united kingdom": "GB", "uk only": "GB", "ireland": "IE", "india": "IN", "pakistan": "PK",
           "philippines": "PH", "brazil": "BR", "mexico": "MX", "argentina": "AR", "colombia": "CO", "canada": "CA",
           "australia": "AU", "singapore": "SG", "malaysia": "MY", "israel": "IL", "egypt": "EG", "south africa": "ZA",
           "costa rica": "CR", "china": "CN", "saudi arabia": "SA", "united arab emirates": "AE", "uae": "AE",
           "japan": "JP", "south korea": "KR", "vietnam": "VN", "thailand": "TH", "indonesia": "ID", "turkey": "TR",
           "nigeria": "NG", "kenya": "KE", "chile": "CL", "peru": "PE", "panama": "PA", "hong kong": "HK",
           "taiwan": "TW", "new zealand": "NZ", "switzerland": "CH", "sweden": "SE", "norway": "NO", "denmark": "DK",
           "finland": "FI", "italy": "IT", "austria": "AT", "belgium": "BE", "czech republic": "CZ", "czechia": "CZ",
           "hungary": "HU", "greece": "GR", "lithuania": "LT", "bulgaria": "BG", "serbia": "RS", "croatia": "HR",
           "estonia": "EE", "latvia": "LV", "morocco": "MA", "qatar": "QA", "bangladesh": "BD", "sri lanka": "LK",
           "nepal": "NP", "uruguay": "UY", "ecuador": "EC", "guatemala": "GT", "dominican republic": "DO",
           "toronto": "CA", "vancouver": "CA", "montreal": "CA", "montréal": "CA", "ottawa": "CA", "calgary": "CA",
           "mississauga": "CA", "ontario": "CA", "british columbia": "CA", "alberta": "CA", "quebec": "CA",
           "bengaluru": "IN", "bangalore": "IN", "hyderabad": "IN", "pune": "IN", "chennai": "IN", "mumbai": "IN",
           "noida": "IN", "gurugram": "IN", "gurgaon": "IN", "new delhi": "IN", "karachi": "PK", "lahore": "PK",
           "manila": "PH", "mexico city": "MX", "guadalajara": "MX", "são paulo": "BR", "sao paulo": "BR",
           "buenos aires": "AR", "bogotá": "CO", "bogota": "CO", "tel aviv": "IL", "zurich": "CH", "munich": "DE",
           "kraków": "PL", "krakow": "PL", "bucharest": "RO", "sydney": "AU"}
_ABROAD_RE = re.compile(r"\b(" + "|".join(sorted(map(re.escape, _ABROAD), key=len, reverse=True)) + r")\b", re.I)
_CURRENCY = {"PLN": "PL", "EUR": "", "GBP": "GB", "INR": "IN", "BRL": "BR", "MXN": "MX", "ARS": "AR", "COP": "CO",
             "AUD": "AU", "€": "", "£": "GB", "₹": "IN"}
_CURRENCY_RE = re.compile(r"(?<![A-Za-z])(PLN|EUR|GBP|INR|BRL|MXN|ARS|COP|AUD)(?![A-Za-z])|[€£₹]")

# A place in the candidate's own country: "United States", a state's name or its code after a comma ("Chicago, IL"). A
# posting that lists one next to a foreign place ("Chicago, IL; Toronto, Canada") is open to the candidate, and a
# state's name ("New Mexico") is not the country it contains. "CA" is California only outside a Canadian province.
_STATES = ("Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Hawaii|Idaho|Illinois|"
           "Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|"
           "Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|"
           "Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|"
           "Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia")
_US_NAME = re.compile(r"\b(united states|usa|u\.s\.a?\.?|us|" + _STATES + r")\b", re.I)
_US_CODE = re.compile(r",\s*(?:AL|AK|AZ|AR|CO|CT|DC|DE|FL|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|"
                      r"NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b")
_CA_STATE = re.compile(r"^(?!.*\b(?:NS|ON|BC|AB|QC|MB|SK|NB|NL|PE)\b).*,\s*CA\b")
_HOME = {"US": None}


def _names_home_place(text: str, country: str) -> bool:
    if country != "US":
        return False
    if _US_NAME.search(text) or _US_CODE.search(text):
        return True
    return any(_CA_STATE.search(part) for part in re.split(r"[;|]", text))


_REMOTE_WORD = re.compile(r"\bremote\b|work from home|\bwfh\b", re.I)


def _first_abroad(text: str, country: str) -> str:
    for match in _ABROAD_RE.finditer(text):
        if _ABROAD[match.group(1).lower()] != country:
            return match.group(1)
    return ""


# Where a description says the job is open: "Remote (Latin America and South Africa)", "must be based in Poland",
# "open to candidates in the EU". Only these phrases are read: a description naming other countries for other reasons
# ("offices in India and the US") says nothing about where the candidate may be.
_OPEN_WHERE = re.compile(
    r"\bremote\s*\(([^)\n]{2,80})\)"
    r"|\b(?:must|should|need\s+to|required\s+to)\s+(?:be\s+)?(?:based|located|residing|reside|live|living)\s+"
    r"(?:in|within)\s+([^\n.;]{2,80})"
    r"|\b(?:open|available)\s+(?:only\s+)?to\s+(?:candidates|applicants|people|those|residents)\s+"
    r"(?:based\s+|located\s+|residing\s+|living\s+)?(?:in|from|of)\s+([^\n.;]{2,80})"
    r"|\b(?:candidates|applicants)\s+(?:must\s+be\s+)?(?:based|located|residing)\s+in\s+([^\n.;]{2,80})", re.I)


def _abroad_in_description(text: str, country: str) -> str:
    """The place outside `country` a description says the job is open in; "" when it names none or names `country`."""
    for match in _OPEN_WHERE.finditer(text or ""):
        phrase = next(group for group in match.groups() if group)
        if _names_home_place(phrase, country):
            return ""
        if abroad := _first_abroad(phrase, country):
            return abroad
    return ""


def outside_country(posting, country: str = "US") -> str:
    """The place outside `country` a posting names in its title or location, says it is open in, or pays in; "" when
    none.

    A location that names a place in `country` wins over a region in the title ("Business Intelligence Analyst Lead -
    LATAM" in Naples, FL), unless the title says the job is remote there ("... - CANADA Remote"). A title that names
    a place in `country` ("Remote - US or Canada") is open to the candidate."""
    title, where = posting.title or "", posting.location or ""
    code = re.search(r",\s*([a-z]{2})\s*$", where)        # freehire's own lower-case country code
    if code and code.group(1).upper() != country:
        return code.group(1).upper()
    where_home = _names_home_place(where, country)
    if not _names_home_place(title, country) and (not where_home or _REMOTE_WORD.search(title)):
        if abroad := _first_abroad(title, country):
            return abroad
    if not where_home and (abroad := _first_abroad(where, country)):
        return abroad
    if not where_home and not _names_home_place(title, country) and \
            (abroad := _abroad_in_description(posting.description or "", country)):
        return abroad
    match = _CURRENCY_RE.search(posting.description or "")
    if match and not where_home and _CURRENCY.get(match.group(0)) != country:
        return f"pay in {match.group(0)}"
    return ""
