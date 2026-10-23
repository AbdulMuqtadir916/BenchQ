"""Every setting says whose it is (backend/settings_scope.py; docs/integration/07-auth-and-tenancy.md F2c)."""
from backend.seed import DEFAULT_SETTINGS, RUNTIME_SETTING_KEYS
from backend.settings_scope import SETTING_SCOPES, Scope, keys_in


def test_every_setting_is_classified():
    known = set(DEFAULT_SETTINGS) | RUNTIME_SETTING_KEYS
    missing = sorted(known - set(SETTING_SCOPES))
    assert not missing, "Classify these in backend/settings_scope.py: " + ", ".join(missing)


def test_no_classified_key_is_gone():
    """A deleted setting leaves the table too, so the list never describes keys that don't exist."""
    known = set(DEFAULT_SETTINGS) | RUNTIME_SETTING_KEYS
    assert sorted(set(SETTING_SCOPES) - known) == []


def test_every_key_that_moves_names_its_track():
    for key, (scope, owner) in SETTING_SCOPES.items():
        if scope is not Scope.PLATFORM:
            assert owner, f"{key} is {scope.value} but names no track to move or delete it"


def test_secrets_are_never_firm_choices():
    """API keys and logins are the platform's (or gone), never a firm's setting."""
    secret = [k for k in SETTING_SCOPES if k.endswith(("_api_key", "_password", "_secret", "_session_id"))]
    assert secret and not set(secret) & set(keys_in(Scope.FIRM_LATER))
