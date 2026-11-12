"""A job posting's text cleaned for a skills lookup.

Only the clean-up part of JobNavigator's backend/analyzer/job_requirements.py, copied as it is: `keyword_match.py`
imports `clean_job_text` from here. The rest of that file (turning a posting into a list of requirements with a model)
is not in BenchQ. Brought in with the résumé tailor (docs/team/tailoring.md).
"""
import re

from backend.analyzer.known_skills import KNOWN_SKILLS

# ── Clean-up ───────────────────────────────────────────────────────────────────

MARKDOWN_ESCAPE = re.compile(r"\\([\\`*_{}\[\]()#+\-.!&|>~])")


def _glued_skill_pattern() -> re.Pattern:
    names = {name for canonical, aliases in KNOWN_SKILLS.items()
             for name in (canonical, *aliases) if len(name) >= 3}
    longest_first = sorted(names, key=len, reverse=True)
    return re.compile("|".join(re.escape(name) for name in longest_first))


GLUED_SKILL_NAME = _glued_skill_pattern()


def _split_glued_skill_names(text: str) -> str:
    """'JenkinsGitHub/GitLabCI/CD' becomes 'Jenkins GitHub/GitLab CI/CD'."""
    pieces = []
    last_end = 0
    for match in GLUED_SKILL_NAME.finditer(text):
        start, end = match.span()
        name = match.group(0)
        before = text[start - 1] if start > 0 else " "
        after = text[end] if end < len(text) else " "
        pieces.append(text[last_end:start])
        if before.islower() and name[0].isupper():
            pieces.append(" ")
        pieces.append(name)
        if after.isupper() and name[-1].isalnum():
            pieces.append(" ")
        last_end = end
    pieces.append(text[last_end:])
    return "".join(pieces)


def clean_job_text(text: str) -> str:
    text = MARKDOWN_ESCAPE.sub(r"\1", text or "")
    text = text.replace("**", "").replace("__", "")
    text = re.sub(r"^[ \t]*#{1,6}[ \t]*", "", text, flags=re.M)
    text = re.sub(r"^[ \t]*[-=]{3,}[ \t]*$", "", text, flags=re.M)
    text = _split_glued_skill_names(text)
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip()
