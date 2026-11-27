"""Refuse a misconfigured start before anything else runs (docs/team/uzair.md, step 6):

    python -m backend.scripts.check_config --role api       # backend/scripts/start.sh
    python -m backend.scripts.check_config --role worker    # backend/scripts/start_worker.sh

Runs before the migration, so a deploy with a wrong setting stops before it changes the database. Never opens the
database: it reads the environment only (backend/startup_checks.py). Exit 1 and the variables' names on stderr when
something is wrong; never a value.
"""
import argparse
import sys

from backend import startup_checks


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the environment this process would start with.")
    parser.add_argument("--role", choices=startup_checks.ROLES, default="api")
    args = parser.parse_args(argv)
    try:
        startup_checks.require_config(args.role)
    except RuntimeError as refused:
        print(str(refused), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
