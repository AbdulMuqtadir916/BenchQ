"""The code tables in docs/02-DATA-CONTRACTS.md §12.1 list exactly the codes in `backend.problem.CODES`.

Read from both tables: the default codes (each "Code" column) and the registry (its "Code" column, without the rows
whose sender is "frontend only": those codes are the frontend's, made in src/lib/api/, never sent by the backend).
"""
import pathlib
import re

import pytest

from backend import problem

DOC = pathlib.Path(__file__).resolve().parents[2] / "docs" / "02-DATA-CONTRACTS.md"
CODE = re.compile(r"^`([A-Z][A-Z0-9_]*)`")


def _section(text: str) -> str:
    start = text.index("### 12.1 Codes")
    return text[start:text.index("\n### ", start + 1)]


def documented_codes(text: str) -> set[str]:
    found, columns, sender = set(), [], None
    for line in _section(text).splitlines():
        if not line.startswith("|"):
            columns = []
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not columns:                                           # a table's header row
            columns = [i for i, cell in enumerate(cells) if cell == "Code"]
            sender = cells.index("Sent by") if "Sent by" in cells else None
            continue
        if sender is not None and cells[sender].startswith("frontend only"):
            continue
        for i in columns:
            if i < len(cells) and (match := CODE.match(cells[i])):
                found.add(match.group(1))
    return found


@pytest.mark.skipif(not DOC.exists(), reason="docs/ is not mounted in this container (docker-compose.yml mounts "
                                                "only ./backend); run with ./docs mounted at /app/docs")
def test_the_doc_lists_exactly_the_registered_codes():
    documented = documented_codes(DOC.read_text(encoding="utf-8"))
    missing, extra = sorted(problem.CODES - documented), sorted(documented - problem.CODES)
    assert not missing, (f"in backend/problem.py CODES but not in docs/02-DATA-CONTRACTS.md §12.1: {missing}. Add a "
                         f"row to the registry table (code, status, sender, whose text), or to the default-code "
                         f"table for a status's default")
    assert not extra, (f"in docs/02-DATA-CONTRACTS.md §12.1 but not in backend/problem.py CODES: {extra}. Register it "
                       f"in backend/problem.py (DEFAULT_CODES or CODES), or mark its row's sender \"frontend only\"")


def test_the_parser_reads_both_tables():
    """Measured, not assumed: a planted section's codes are read, the frontend's are not."""
    planted = ("### 12.1 Codes\n\n| Status | Code | Status | Code |\n|---|---|---|---|\n"
               "| 400 | `BAD_REQUEST` | 415 | `UNSUPPORTED_TYPE` *new* |\n\n"
               "| Code | Status | Sent by | Text |\n|---|---|---|---|\n"
               "| `DAILY_LIMIT` | 429 | `api/x.py:1` | backend |\n| any default code | any | every other | backend |\n"
               "| `NETWORK` | 0 | frontend only: `http.ts` | frontend |\n\n### 12.2 Rules\n| `LATER` | x |\n")
    assert documented_codes(planted) == {"BAD_REQUEST", "UNSUPPORTED_TYPE", "DAILY_LIMIT"}
