"""The résumé tailor (docs/team/tailoring.md): one candidate's résumé version and one job posting in, a tailored
version's content out. Mads Lorentzen's /apply CV workflow ("Updated_focused" in JobNavigator), from the tailoring
handoff: five GPT-6 Luna calls through OpenRouter, then code that checks every bullet against its own role.

- `run.py`       `tailor_version`, the one entry point, and `report_counts`, what is kept of the report
- `stored.py`    the version into the tailor's base résumé, and the copy back into a version
- `pipeline.py`  the five steps and the exact edits; `fact_gate.py`, `checks.py` the code gate
- `copy_builder.py`, `resume_bits.py`  the copy put together from the final draft and the résumé's own facts
- `prompts.py`, `schemas.py`  the default prompts and response formats, seeded into settings (`settings.py`)

No database writes and no routes here: the caller reads the version and the setup and stores what comes back.
"""
