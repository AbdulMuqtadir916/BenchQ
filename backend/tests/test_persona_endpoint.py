"""GET/PATCH /api/persona — singleton CRUD."""


def test_persona_get_returns_singleton(api_client, test_db):
    """GET returns the seeded persona with all 8 nodes."""
    from backend.seed import seed_persona
    seed_persona(test_db)

    resp = api_client.get("/api/persona")
    assert resp.status_code == 200
    data = resp.json()
    for k in ("contact", "work_auth", "demographics", "compensation",
              "preferences", "resume_content", "qa_bank"):
        assert k in data, f"missing node: {k}"


def test_persona_patch_merges_into_node(api_client, test_db):
    """PATCH updates one node without touching others."""
    from backend.seed import seed_persona
    seed_persona(test_db)

    resp = api_client.patch(
        "/api/persona",
        json={"contact": {"name": "Viktor Esadze", "email": "viktor@example.com"}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["contact"] == {"name": "Viktor Esadze", "email": "viktor@example.com"}
    # Other nodes untouched
    assert data["work_auth"] == {}


def test_persona_patch_rejects_unknown_node(api_client, test_db):
    """PATCH with an unknown key gets 400, doesn't silently mutate."""
    from backend.seed import seed_persona
    seed_persona(test_db)

    resp = api_client.patch("/api/persona", json={"random_node": {"x": 1}})
    assert resp.status_code == 400


def test_persona_patch_replaces_node_atomically(api_client, test_db):
    """PATCH replaces the WHOLE node content; doesn't deep-merge inside it.
    Caller is responsible for sending the complete node value."""
    from backend.seed import seed_persona
    from backend.models.db import Persona
    seed_persona(test_db)

    p = test_db.query(Persona).filter(Persona.id == 1).first()
    p.contact = {"name": "Alice", "phone": "+1"}
    test_db.commit()

    resp = api_client.patch("/api/persona", json={"contact": {"name": "Bob"}})
    assert resp.status_code == 200
    assert resp.json()["contact"] == {"name": "Bob"}  # phone gone
