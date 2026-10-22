"""BenchQ staff set a new password from the command line (07 Q39): any account, signed out everywhere, logged."""
import io

import pytest

from backend.scripts import reset_password as cli
from backend.tests.auth_support import TEST_PASSWORD


def _sign_in(client, email, password):
    return client.post("/api/auth/sign-in", json={"email": email, "password": password})


def test_a_firm_user_gets_a_new_password_and_is_signed_out(anonymous_client, test_db, accounts, monkeypatch, capsys):
    from backend.models.tenancy import LedgerEntry
    me = {"cookie": f"bq_session={accounts.firm_token}"}
    assert anonymous_client.get("/api/auth/me", headers=me).status_code == 200
    monkeypatch.setattr("sys.stdin", io.StringIO("a-brand-new-pass\n"))
    assert cli.main(["--email", " Owner@Acme.test ", "--password-stdin"]) == 0
    assert "New password set for Olivia Owner <owner@acme.test>" in capsys.readouterr().out
    assert anonymous_client.get("/api/auth/me", headers=me).status_code == 401
    assert _sign_in(anonymous_client, "owner@acme.test", TEST_PASSWORD).status_code == 401
    assert _sign_in(anonymous_client, "owner@acme.test", "a-brand-new-pass").status_code == 200
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_id == str(accounts.user_id), LedgerEntry.actor_name == "reset_password").one()
    assert (entry.firm_id, entry.actor_type, entry.action, entry.entity_type) == (accounts.firm_id, "SYSTEM", "UPDATE", "user")
    assert "a-brand-new-pass" not in entry.summary


def test_a_super_admin_too(anonymous_client, test_db, accounts, monkeypatch):
    from backend.models.tenancy import LedgerEntry
    monkeypatch.setattr("sys.stdin", io.StringIO("admin-new-pass\n"))
    assert cli.main(["--email", "admin@benchq.test", "--password-stdin"]) == 0
    assert _sign_in(anonymous_client, "admin@benchq.test", "admin-new-pass").json()["principal"]["kind"] == "platform"
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_id == str(accounts.admin_id), LedgerEntry.actor_name == "reset_password").one()
    assert (entry.firm_id, entry.entity_type) == (None, "platform_user")


def test_the_password_is_asked_twice(test_db, accounts, monkeypatch, capsys):
    answers = iter(["one-password", "another-password"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt: next(answers))
    assert cli.main(["--email", "owner@acme.test"]) == 1
    assert "The passwords don't match." in capsys.readouterr().err


@pytest.mark.parametrize("email,password,message", [
    ("nobody@acme.test", "long-enough-pass", "No account uses nobody@acme.test."),
    ("owner@acme.test", "short", "Use at least 8 characters for the password."),
    ("not-an-email", "long-enough-pass", "Enter a valid email address."),
])
def test_the_command_refuses(anonymous_client, test_db, accounts, email, password, message):
    with pytest.raises(cli.Refused, match=message):
        cli.reset_password(test_db, email=email, password=password)
    assert _sign_in(anonymous_client, "owner@acme.test", TEST_PASSWORD).status_code == 200
