"""The classifier's editable State and Question (08-ai-presets.md): their default text, save checks and how a preset's
text becomes a Decisions request. A preset from before they were editable holds only `instructions`, and still works."""
import json
import re

from backend.inbox.decider_categories import CATEGORIES, INSTRUCTIONS, QUESTION_KEY

_STATE = [{"subject": "{subject}", "body": "{body}"}]
_FIELD = re.compile(r"\{(subject|body)\}")


def _as_text(value) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False)


def _question(instructions: str) -> dict:
    return {QUESTION_KEY: {"type": "choice", "instructions": instructions, "criteria": dict(CATEGORIES)}}


DEFAULT_STATE = _as_text(_STATE)
DEFAULT_QUESTION = _as_text(_question(INSTRUCTIONS))


def shown_prompts(prompts: dict) -> dict:
    """The State and Question text of a stored preset, old or new."""
    return {"state": prompts.get("state") or DEFAULT_STATE,
            "question": prompts.get("question") or _as_text(_question(prompts.get("instructions") or INSTRUCTIONS))}


def request_parts(prompts: dict) -> tuple[list, dict]:
    shown = shown_prompts(prompts)
    return json.loads(shown["state"]), json.loads(shown["question"])


def filled_state(state: list, subject: str, body: str) -> list:
    """One pass over the parsed template, so text inside an email is never read as JSON or as another field."""
    values = {"subject": subject, "body": body}
    return [{key: _FIELD.sub(lambda match: values[match.group(1)], value) for key, value in item.items()}
            for item in state]


def identity_prompts(prompts: dict) -> dict:
    """What the fingerprint hashes: the default State and Question hash as they did before they were editable, so moving
    to the editable form doesn't force a re-evaluation. A real change still does."""
    if "state" not in prompts and "question" not in prompts:
        return prompts
    state, questions = request_parts(prompts)
    question = questions[QUESTION_KEY]
    if state == _STATE and question["criteria"] == CATEGORIES:
        return {"instructions": "" if question["instructions"] == INSTRUCTIONS else question["instructions"]}
    return {"state": state, "question": questions}


def _state_problem(text: str) -> str | None:
    try:
        state = json.loads(text)
    except ValueError:
        return "State must be valid JSON."
    if (not isinstance(state, list) or not state
            or not all(isinstance(item, dict) and item and all(isinstance(v, str) for v in item.values())
                       for item in state)):
        return "State must be a list of objects whose values are text."
    found = {name for item in state for value in item.values() for name in _FIELD.findall(value)}
    return None if found == {"subject", "body"} else "State must use {subject} and {body} inside its values."


def _question_problem(text: str) -> str | None:
    try:
        questions = json.loads(text)
    except ValueError:
        return "Question must be valid JSON."
    if not isinstance(questions, dict) or set(questions) != {QUESTION_KEY}:
        return f"Question must keep the single key {QUESTION_KEY}."
    question = questions[QUESTION_KEY]
    if not isinstance(question, dict) or set(question) != {"type", "instructions", "criteria"}:
        return "Question must have only type, instructions and criteria."
    if question["type"] != "choice":
        return 'Question type must stay "choice".'
    if not isinstance(question["instructions"], str) or not question["instructions"].strip():
        return "Question instructions can't be empty."
    criteria = question["criteria"]
    if not isinstance(criteria, dict) or set(criteria) != set(CATEGORIES):
        return "Question must keep the 10 category names; only their descriptions can change."
    if not all(isinstance(value, str) and value.strip() for value in criteria.values()):
        return "Every category needs a description."
    return None


def request_problems(prompts: dict) -> list[str]:
    """Why this State or Question can't be saved. Names the problem, never the text."""
    checks = (("state", _state_problem), ("question", _question_problem))
    return [problem for name, check in checks
            if isinstance(prompts.get(name), str) and prompts[name].strip() and (problem := check(prompts[name]))]
