"""Which of a posting's skills a résumé names: a dictionary lookup, with no model involved."""
import json
import re
from functools import lru_cache
from pathlib import Path

from backend.analyzer.job_requirements import clean_job_text

DICTIONARY_PATH = Path(__file__).resolve().parents[1] / "analyzer" / "data" / "skills_dictionary.json"
LONGEST_SKILL_WORDS = 4
# The dictionary's keyword types.
HARD_SKILL, SOFT_SKILL, OTHER_KEYWORD = "hard", "soft", "other"
KEYWORD_TYPES = (HARD_SKILL, SOFT_SKILL, OTHER_KEYWORD)
WORD = re.compile(r"[A-Za-z0-9+#]+(?:[./-][A-Za-z0-9+#]+)*|\.[A-Za-z]+")
# Punctuation between two words that ends a phrase: "Kubernetes, Docker, container orchestration" names Docker,
# not a "Docker container".
ENDS_A_PHRASE = re.compile(r"[,;:()\[\]{}|\n•]|\.\s")


@lru_cache(maxsize=1)
def _dictionary() -> dict:
    """How a text may write a keyword, lower case -> [standard name, 1 when it needs its capital, type number]."""
    forms = json.loads(DICTIONARY_PATH.read_text())["forms"]
    # Common technologies the dictionary holds only as lower-case tags, which technologies() leaves out (lab v14).
    for form, name in {'perl': 'Perl', 'netty': 'Netty', 'puppet': 'Puppet', 'jboss': 'JBoss', 'weblogic': 'WebLogic', 'websphere': 'WebSphere', 'tomcat': 'Apache Tomcat', 'apache tomcat': 'Apache Tomcat', 'ejb': 'EJB', 'servlet': 'Java Servlets', 'servlets': 'Java Servlets', 'jsp': 'JSP', 'jsf': 'JSF', 'asp.net': 'ASP.NET', 'asp.net core': 'ASP.NET', 'vb.net': 'VB.NET', 'cobol': 'COBOL', 'jcl': 'JCL', 'db2': 'Db2', 'tibco': 'TIBCO', 'sharepoint': 'SharePoint', 'quarkus': 'Quarkus', 'micronaut': 'Micronaut', 'rabbitmq': 'RabbitMQ', 'ibm mq': 'IBM MQ', 'ibm-mq': 'IBM MQ', 'apache camel': 'Apache Camel', 'apache-camel': 'Apache Camel', 'jpa': 'JPA', 'maven': 'Maven', 'gradle': 'Gradle', 'mockito': 'Mockito', 'selenium': 'Selenium', 'nestjs': 'NestJS', 'matlab': 'MATLAB', 'spss': 'SPSS', 'dbt': 'dbt', 'sqlite': 'SQLite', 'teradata': 'Teradata', 'abap': 'ABAP', 'guidewire': 'Guidewire', 'pega': 'Pega', 'dynamics 365': 'Dynamics 365', 'dynamics-365': 'Dynamics 365', 'sitecore': 'Sitecore', 'drupal': 'Drupal', 'wordpress': 'WordPress', 'laravel': 'Laravel', 'symfony': 'Symfony', 'erlang': 'Erlang', 'haskell': 'Haskell', 'fortran': 'Fortran', 'verilog': 'Verilog', 'vhdl': 'VHDL', 'labview': 'LabVIEW', 'scada': 'SCADA', 'rtos': 'RTOS', 'pgvector': 'pgvector', 'struts': 'Apache Struts', 'apache struts': 'Apache Struts', 'diffusion models': 'Diffusion Models', 'diffusion model': 'Diffusion Models'}.items():
        forms[form] = [name, 0, 0]
    for form, name in {'puppet': 'Puppet', 'cucumber': 'Cucumber', 'sas': 'SAS', 'looker': 'Looker', 'lte': 'LTE', 'plc': 'PLC'}.items():     # also everyday words: count only when written with a capital
        forms[form] = [name, 1, 0]
    return forms


def _lookup(words: list) -> tuple | None:
    """The dictionary entry for these words, trying the phrase as written and with its hyphens as spaces."""
    return _lookup_phrase(" ".join(words).lower())


@lru_cache(maxsize=250_000)
def _lookup_phrase(phrase: str) -> tuple | None:
    """Remembered per phrase: a résumé scored against a hundred postings asks about the same words over and over."""
    for form in (phrase, phrase.replace("-", " ")):
        entry = _dictionary().get(form)
        if entry:
            return entry
    return None


def skills_in(text: str) -> dict:
    """{standard name: {"count", "as_written", "type"}} for every dictionary keyword in the text, longest phrase first.

    "as_written" is the first way the text writes it.
    """
    found = {}
    for mention in mentions_in(text):
        named = found.setdefault(mention["standard"], {"count": 0, "as_written": mention["as_written"], "type": mention["type"]})
        named["count"] += 1
    return found


def mentions_in(text: str) -> list:
    """Every dictionary keyword the text writes, in order, as {"standard", "as_written", "type"}, longest phrase first.

    Two ways of writing one standard name stay two mentions: "Agile/Scrum" names Agile as "Agile" and as "Scrum".
    """
    words, starts_a_phrase = _words_and_where_phrases_start(text or "")
    mentions = []
    position = 0
    while position < len(words):
        for size in range(min(LONGEST_SKILL_WORDS, len(words) - position), 0, -1):
            if any(starts_a_phrase[position + 1:position + size]):
                continue
            phrase = words[position:position + size]
            entry = _lookup(phrase)
            if entry and _is_written_as_a_skill(phrase[0], needs_capital=entry[1]):
                mentions.append(_mention(entry, " ".join(phrase)))
                position += size
                break
        else:
            mentions += _skills_joined_by_slashes(words[position])
            position += 1
    return mentions


def _skills_joined_by_slashes(word: str) -> list:
    """"AWS/Azure/GCP" is three skills written as one word. "CI/CD" is one, and never reaches here."""
    if "/" not in word:
        return []
    mentions = []
    for part in word.split("/"):
        entry = _lookup([part]) if part else None
        if entry and _is_written_as_a_skill(part, needs_capital=entry[1]):
            mentions.append(_mention(entry, part))
    return mentions


def _mention(entry: list, as_written: str) -> dict:
    return {"standard": entry[0], "as_written": as_written, "type": KEYWORD_TYPES[entry[2]]}


def _words_and_where_phrases_start(text: str) -> tuple:
    """The words of the text, and for each whether punctuation separates it from the word before."""
    words, starts_a_phrase = [], []
    end_of_the_word_before = 0
    for match in WORD.finditer(text):
        words.append(match.group())
        starts_a_phrase.append(bool(ENDS_A_PHRASE.search(text[end_of_the_word_before:match.start()])))
        end_of_the_word_before = match.end()
    return words, starts_a_phrase


def _is_written_as_a_skill(first_word: str, needs_capital: int) -> bool:
    """"Go" and "Swift" are skills; "go" and "swift" are ordinary words."""
    return not needs_capital or first_word[:1].isupper()


def keyword_match(resume_text: str, job_text: str) -> dict:
    """The posting's named tools split into those the résumé names and those it does not, as the posting writes them."""
    wanted = {name: mention for name, mention in skills_in(clean_job_text(job_text)).items()
              if mention["type"] == HARD_SKILL}
    shown = skills_in(resume_text)
    matched = [mention["as_written"] for name, mention in wanted.items() if name in shown]
    missing = [mention["as_written"] for name, mention in wanted.items() if name not in shown]
    coverage = round(100 * len(matched) / len(wanted)) if wanted else None
    return {"matched_keywords": matched, "missing_keywords": missing, "keyword_coverage_pct": coverage}
