"""Plain-text helpers the match scores share: words folded the way a search box folds them, literal phrase matching,
the credit for a keyword mentioned fewer times than the posting mentions it, and degree levels.

No imports from the rest of the project, so a copy of it carries no other module along.
"""
import re

SAME_WORD = {"restful": "rest"}
A_WORD = re.compile(r"[a-z0-9+#]+")


# ── Folding: the safe differences ──────────────────────────────────────────────

def folded_words(text: str) -> list:
    """The words of the text in the form two spellings of the same term share."""
    return [_folded(word) for word in A_WORD.findall((text or "").lower())]


def _folded(word: str) -> str:
    word = SAME_WORD.get(word, word)
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def _contains(words: list, phrase: list) -> bool:
    if not phrase:
        return False
    size = len(phrase)
    return any(words[start:start + size] == phrase for start in range(len(words) - size + 1))


def _credit(times_in_posting: int, times_in_resume: int) -> float:
    """Nothing when never mentioned, at least half for one mention, all of it when mentioned as often as the posting."""
    if times_in_resume == 0:
        return 0.0
    if times_in_resume >= times_in_posting:
        return 1.0
    return 0.5 + 0.5 * times_in_resume / times_in_posting


# ── Degree levels ──────────────────────────────────────────────────────────────

# Degree levels, lowest to highest, with the wordings that state each one. The words are matched in any case; the
# abbreviations only in capitals and only where they read as a degree ("BS in", "BS/MS", "M.S."), since in lower case
# they are everyday words ("be", "me", "ms") and in capitals "MS" is also Microsoft ("MS SQL Server", "MS Office").
_MS_PRODUCT = (r"SQL|Office|Excel|Word|Access|Teams|Azure|Dynamics|Project|Visio|PowerPoint|Outlook|Power|Fabric|Graph"
               r"|Exchange|SharePoint|365|Windows|DOS|Intune|Entra|Purview|Defender|Sentinel|Copilot|CRM|BI|Edge|SCCM"
               r"|Flow|Forms|Planner|Stream|Lync|Skype|Server|Visual|VS|IIS|TFS|DevOps|D365|\.NET")
DEGREE_LEVELS = [
    ("an Associate degree", r"\bassociate'?s?\s+degree|\bassociate of (?:arts|science|applied)|(?<!school )\bdiploma\b"
                            r"|(?-i:\bA\.A\.S?\.|\bAAS\b)"),
    ("a Bachelor's degree", r"\bbachelor|\bundergraduate degree|\bany graduate\b|\b(?:4|four)[- ]year (?:college )?degree"
                            r"|(?-i:\bB\.\s?Tech\b|\bB\.?Tech\b|\bB\.E\.|\bBE\b(?=\s+(?:in|degree)\b)|\bB\.S\.(?:c\.?)?"
                            r"|\bBSc\b|\bBS\b(?=\s*(?:in\b|degree\b|/|or\b|,|\)|[A-Z]))|\bB\.A\.|\bBA\b(?=\s*(?:in\b|degree\b|/|or\b))"
                            r"|\bUG\b(?=\s+degree))"),
    ("a Master's degree", r"(?<!scrum )\bmaster'?s\b|\bmaster of\b|\bgraduate degree|\bpost[- ]?graduate"
                          r"|(?-i:\bMBA\b|\bM\.?\s?Tech\b|\bM\.E\.|\bM\.S\.(?:c\.?)?|\bMSc\b|\bM\.A\."
                          rf"|\bMS\b(?!\s*(?:{_MS_PRODUCT})\b)(?=\s*(?:in\b|degree\b|/|or\b|,|\)|[A-Z]|$))"
                          r"|\bPG\b(?=\s+(?:degree|diploma)))"),
    ("a Ph.D.", r"\bph\.?\s?d\b|\bdoctorate|\bdoctoral"),
]
_DEGREE_RES = [re.compile(pattern, re.I) for _, pattern in DEGREE_LEVELS]
# A line naming a degree with no level ("a degree in Computer Science", "college degree") asks for a Bachelor's.
_ANY_DEGREE = re.compile(r"\bdegree in\b|\b(?:college|university) degree\b|\bdegree from an? (?:accredited )?(?:college|university)",
                         re.I)
BACHELORS_LEVEL = 2
# A degree field on a résumé starts with its abbreviation ("MS Computer Science", "B.E. (ECE)", "PhD Physics").
_ENTRY_ABBREVIATION = (
    (4, re.compile(r"^\s*(?:ph\.?\s?d|d\.?\s?phil|doctor)\b", re.I)),
    (3, re.compile(r"^\s*(?:m\.?\s?s\.?c?|m\.?\s?a|m\.?\s?e|m\.?\s?tech|mba|m\.?\s?eng|m\.?\s?com|mca|pgd\w*)\b\.?", re.I)),
    (2, re.compile(r"^\s*(?:b\.?\s?s\.?c?|b\.?\s?a|b\.?\s?e|b\.?\s?tech|b\.?\s?eng|b\.?\s?com|bca|bba)\b\.?", re.I)),
    (1, re.compile(r"^\s*(?:a\.?\s?a\.?s?|a\.?\s?s)\b\.?", re.I)),
)


def _degree_levels_in(text: str) -> list:
    """The degree levels (1 Associate … 4 Ph.D.) a text names; a degree with no level counts as a Bachelor's."""
    found = [level for level, pattern in enumerate(_DEGREE_RES, start=1) if pattern.search(text or "")]
    if not found and _ANY_DEGREE.search(text or ""):
        found = [BACHELORS_LEVEL]
    return found


def degree_level_of_entry(degree: str) -> int:
    """The level of one résumé education entry's degree ("MS Computer Science" is 3); 0 when it names none."""
    found = _degree_levels_in(degree)
    if found:
        return max(found)
    return next((level for level, pattern in _ENTRY_ABBREVIATION if pattern.search(degree or "")), 0)
