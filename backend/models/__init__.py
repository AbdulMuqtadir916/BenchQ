# Registers every model module on the shared Base, so Alembic, the tests and the app see all tables.
from backend.models import tenancy  # noqa: F401
from backend.models import candidates  # noqa: F401
