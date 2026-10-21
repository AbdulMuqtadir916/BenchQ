"""The first Super Admin from the command line, and the mocks' demo world in the database (07 Q38; 07-auth F5)."""
import io
import json
import pathlib

import pytest

from backend.scripts import create_platform_admin as cli
from backend.scripts import seed_demo

DATA = seed_demo.DATA_DIR
needs_mock_data = pytest.mark.skipif(not DATA.exists(), reason="the frontend's mock data isn't in this checkout")


def _sign_in(client, email, password):
    return client.post("/api/auth/sign-in", json={"email": email, "password": password})


# ── create_platform_admin ────────────────────────────────────────────────────

def test_the_command_creates_a_super_admin_who_can_sign_in(anonymous_client, test_db, monkeypatch, capsys):
    from backend.models.tenancy import LedgerEntry, PlatformUser
    monkeypatch.setattr("sys.stdin", io.StringIO("first-admin-pass\n"))
    assert cli.main(["--email", " Root@Example.test ", "--name", "Root", "--password-stdin"]) == 0
    assert "Created Super Admin Root <root@example.test>" in capsys.readouterr().out
    admin = test_db.query(PlatformUser).filter(PlatformUser.email == "root@example.test").one()
    assert admin.password_hash.startswith("$argon2id$")
    entry = test_db.query(LedgerEntry).filter(LedgerEntry.entity_id == str(admin.id)).one()
    assert (entry.actor_type, entry.action, entry.firm_id) == ("SYSTEM", "CREATE", None)
    assert _sign_in(anonymous_client, "root@example.test", "first-admin-pass").json()["principal"]["kind"] == "platform"


def test_the_password_is_asked_twice(test_db, monkeypatch, capsys):
    answers = iter(["one-password", "another-password"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt: next(answers))
    assert cli.main(["--email", "root@example.test", "--name", "Root"]) == 1
    assert "The passwords don't match." in capsys.readouterr().err


@pytest.mark.parametrize("email,name,password,message", [
    ("not-an-email", "Root", "long-enough", "Enter a valid email address."),
    ("root@example.test", " ", "long-enough", "Enter a name."),
    ("root@example.test", "Root", "short", "Use at least 8 characters for the password."),
    ("owner@acme.test", "Root", "long-enough", "owner@acme.test already has an account."),
])
def test_the_command_refuses(test_db, accounts, email, name, password, message):
    with pytest.raises(cli.Refused, match=message):
        cli.create_platform_admin(test_db, email=email, name=name, password=password)


# ── seed_demo ────────────────────────────────────────────────────────────────

@needs_mock_data
def test_the_seed_loads_the_mocks_world_and_is_idempotent(test_db):
    added = seed_demo.seed(test_db)
    test_db.commit()
    firm = json.loads((DATA / "firm.json").read_text())
    assert added == {"plans": 3, "firms": len(firm["firms"]), "users": len(firm["users"]), "platform_users": 1,
                     "invites": len(json.loads((DATA / "invites.json").read_text()))}
    assert set(seed_demo.seed(test_db).values()) == {0}


def test_ids_are_the_same_on_every_machine():
    """Pinned: changing the namespace would give every demo row a new id on every teammate's machine."""
    assert str(seed_demo.demo_id("firm_hts")) == "d6d0fdd5-f446-5517-bef3-1df9447e2b91"


@needs_mock_data
def test_the_frontends_id_map_is_the_seeds():
    """src/lib/api/dto/demo-ids.json lets the frontend keep fixture ids on a live session (src/lib/api/dto/demo-ids.ts).
    Regenerate it with UPDATE_DEMO_IDS=1 pnpm exec vitest run src/lib/api/dto/demo-ids.test.ts."""
    path = pathlib.Path(__file__).parents[2] / "src" / "lib" / "api" / "dto" / "demo-ids.json"
    if not path.exists():
        pytest.skip("the frontend isn't in this checkout (the backend container)")
    ids = json.loads(path.read_text())
    ids_now = seed_demo._fixture_ids()
    assert len(ids) == sum(len(group) for group in ids_now.values())
    assert all(str(seed_demo.demo_id(fixture)) == uuid for fixture, uuid in ids.items())


@needs_mock_data
def test_every_seed_account_signs_in_with_the_demo_password(anonymous_client, test_db):
    """docs/03 §3.2: done when signing in as each seeded account works against the backend."""
    seed_demo.seed(test_db)
    test_db.commit()
    firm = json.loads((DATA / "firm.json").read_text())
    slugs = {f["id"]: f["slug"] for f in firm["firms"]}
    for user in firm["users"]:
        r = _sign_in(anonymous_client, user["email"], seed_demo.DEMO_PASSWORD)
        assert r.status_code == 200, user["email"]
        assert r.json()["firm"]["slug"] == slugs[user["firmId"]]
    assert _sign_in(anonymous_client, "sana@admin.benchq.test", seed_demo.DEMO_PASSWORD).json()["principal"]["kind"] \
        == "platform"


@needs_mock_data
def test_the_seeded_firms_behave(anonymous_client, test_db):
    seed_demo.seed(test_db)
    test_db.commit()
    _sign_in(anonymous_client, "naveen@cyberabad-bench.benchq.test", seed_demo.DEMO_PASSWORD)
    assert anonymous_client.get("/api/jobs").status_code == 403                         # SUSPENDED
    _sign_in(anonymous_client, "imran@hyderabad-tech-staffing.benchq.test", seed_demo.DEMO_PASSWORD)
    firm_id = anonymous_client.get("/api/auth/me").json()["firm"]["id"]
    invites = {i["email"]: i["status"] for i in anonymous_client.get(f"/api/firms/{firm_id}/invites").json()}
    assert invites["nikhil@hyderabad-tech-staffing.benchq.test"] == "PENDING"            # shifted: still pending
    assert invites["old.lead@hyderabad-tech-staffing.benchq.test"] == "EXPIRED"          # shifted: still expired


@needs_mock_data
def test_a_seeded_invite_gets_a_link_by_resending(anonymous_client, test_db):
    from backend.models.tenancy import Invite
    seed_demo.seed(test_db)
    test_db.commit()
    _sign_in(anonymous_client, "sana@admin.benchq.test", seed_demo.DEMO_PASSWORD)
    invite = test_db.get(Invite, seed_demo.demo_id("inv_gsc_owner"))
    token = anonymous_client.post(f"/api/admin/invites/{invite.id}/resend").json()["invite_token"]
    anonymous_client.post("/api/auth/sign-out")
    session = anonymous_client.post(f"/api/invites/{token}/accept", json={"name": "Gia", "password": "gia-pass-1"}).json()
    assert session["firm"]["slug"] == "gachibowli-staffing"
    assert session["firm"]["status"] == "ACTIVE"


@needs_mock_data
def test_reset_removes_the_demo_rows_and_what_hangs_off_them(anonymous_client, test_db):
    from backend.models.tenancy import Firm, LedgerEntry, Session, User
    seed_demo.seed(test_db)
    test_db.commit()
    _sign_in(anonymous_client, "imran@hyderabad-tech-staffing.benchq.test", seed_demo.DEMO_PASSWORD)  # a session + LOGIN
    imran = seed_demo.demo_id("user_imran")
    seed_demo.reset(test_db)
    test_db.commit()
    assert test_db.query(Firm).filter(Firm.id == seed_demo.demo_id("firm_hts")).count() == 0
    assert test_db.query(User).filter(User.id == imran).count() == 0
    assert test_db.query(Session).filter(Session.user_id == imran).count() == 0
    assert test_db.query(LedgerEntry).filter(LedgerEntry.actor_user_id == imran).count() == 0
    # Everything that isn't demo data stays: the test fixture's firm and its sessions.
    assert test_db.query(Firm).filter(Firm.slug == "acme").count() == 1
    assert test_db.query(Session).count() == 2
    assert seed_demo.seed(test_db)["users"] > 0


def test_the_seed_refuses_production(monkeypatch, capsys):
    monkeypatch.setattr(seed_demo, "IS_PRODUCTION", True)
    assert seed_demo.main([]) == 1
    assert "production" in capsys.readouterr().err


def test_the_seed_names_a_missing_data_folder(test_db, monkeypatch):
    monkeypatch.setattr(seed_demo, "DATA_DIR", pathlib.Path("/nowhere"))
    with pytest.raises(seed_demo.Refused, match="BENCHQ_MOCK_DATA"):
        seed_demo.seed(test_db)
