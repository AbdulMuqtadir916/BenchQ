"""Every route reads firm-owned rows through `scoped()` (docs/integration/07-auth-and-tenancy.md F4).

A grep-like check over the routers, as the frontend's `no-path-literals` test does: a `db.query(...)` or `select(...)`
that names a firm-owned model outside `backend/auth/scoping.py` fails, unless the function is listed in `ALLOWED`
with the reason it may see every firm's rows. A firm-owned model is one with a NOT NULL `firm_id` (F2b), so a table
that gains one later is covered without touching this file.
"""
import ast
from pathlib import Path

from backend.models.db import Base

BACKEND = Path(__file__).resolve().parents[1]
ROUTE_FILES = sorted((BACKEND / "api").glob("routes_*.py")) + [BACKEND / "main.py"]

# (file, function) -> why it may query a firm-owned model without `scoped()`.
ALLOWED = {
    # Searches are run by the platform (Super Admin routes, F2b); a firm's own searches come with the Jobs track.
    ("routes_searches.py", "list_searches"): "platform route",
    ("routes_searches.py", "update_search"): "platform route",
    ("routes_searches.py", "delete_search"): "platform route",
    ("routes_searches.py", "acknowledge_search_warning"): "platform route",
    ("routes_searches.py", "trigger_search"): "platform route",
    ("routes_searches.py", "test_search"): "platform route",
    ("routes_jobs.py", "save_from_extension"): "reads the platform's Extension search for its filters",
    ("main.py", "get_scheduler_jobs"): "platform route",
    ("routes_companies.py", "list_companies"): "global companies; filters application counts by firm itself",
    ("main.py", "get_failing_entities"): "platform health view of searches",
    ("main.py", "trigger_auto_reject"): "platform job (Super Admin route) over every firm's applications",
    ("main.py", "_tracer_click_and_redirect"): "public link: found by its token, logs the click on the link's firm",
    # Tracer tokens are unique across firms, so the collision check must see every firm's links.
    ("routes_resumes.py", "_rewrite_urls_with_tracers"): "a token is unique across firms",
    # A job's scores sit on the shared job row until the Jobs track gives each firm its own (JobMark, Q36), so the
    # "last tailored copy gone" check counts every firm's copies.
    ("routes_resumes.py", "_clear_orphan_tailored_score"): "job scores are shared across firms for now",
    # Background workers: the route that launched them already checked the ids against the user's firm.
    ("routes_resumes.py", "_tailor_impl"): "worker; ids checked by tailor_resume",
    ("routes_resumes.py", "_score_resume_impl"): "worker; ids checked by score_check",
    ("routes_cover_letters.py", "_generate_inner"): "worker; ids checked by generate_cover_letter",
}


def _firm_owned_models() -> set[str]:
    names = set()
    for mapper in Base.registry.mappers:
        column = mapper.columns.get("firm_id")
        if column is not None and not column.nullable and mapper.class_.__module__ in (
                "backend.models.db", "backend.models.tenancy") and mapper.class_.__tablename__ in _F2B_TABLES:
            names.add(mapper.class_.__name__)
    return names


# The firm-owned tables F2b created or filled (migration 0005). The tenancy tables (users, invites, ...) carry a
# firm_id too, but their routes check membership themselves (routes_firms, routes_team).
_F2B_TABLES = {"searches", "applications", "interviews", "resumes", "cover_letters", "tracer_links",
               "tracer_click_events", "firm_jobs"}


def _root_name(node):
    while isinstance(node, (ast.Attribute, ast.Call)):
        node = node.value if isinstance(node, ast.Attribute) else node.func
    return node.id if isinstance(node, ast.Name) else None


def _violations(path: Path, models: set[str]) -> list[str]:
    tree = ast.parse(path.read_text())
    found = []

    def visit(node, functions):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions = (*functions, node.name)
        if isinstance(node, ast.Call):
            func = node.func
            is_query = isinstance(func, ast.Attribute) and func.attr == "query"
            is_select = isinstance(func, ast.Name) and func.id == "select"
            if is_query or is_select:
                named = {_root_name(arg) for arg in node.args} & models
                # A nested helper is covered by the function it sits in.
                if named and not any((path.name, fn) in ALLOWED for fn in functions):
                    where = functions[-1] if functions else "<module>"
                    found.append(f"{path.name}:{node.lineno} {where}() queries {', '.join(sorted(named))}")
        for child in ast.iter_child_nodes(node):
            visit(child, functions)

    visit(tree, ())
    return found


def test_the_firm_owned_models_are_known():
    assert _firm_owned_models() == {"Search", "Application", "Interview", "Resume", "CoverLetter", "TracerLink",
                                    "TracerClickEvent", "FirmJob"}


def test_routes_read_firm_rows_only_through_scoped():
    models = _firm_owned_models()
    found = [v for path in ROUTE_FILES for v in _violations(path, models)]
    assert not found, ("Query firm-owned rows with backend.auth.scoping.scoped(), or add the function to ALLOWED "
                       "with the reason it may see every firm:\n" + "\n".join(found))


def test_every_allowed_function_exists():
    """A renamed or deleted function must leave ALLOWED too, so the list never hides a new one by accident."""
    defined = set()
    for path in ROUTE_FILES:
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                defined.add((path.name, node.name))
    assert set(ALLOWED) - defined == set()
