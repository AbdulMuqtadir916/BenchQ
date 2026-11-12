"""Settings can be updated without warnings when the scheduler reconfigures."""


def test_patch_settings_no_warnings_on_clean_reconfig(api_client, test_db):
    """When all reconfigs succeed, response should NOT include warnings (or empty list)."""
    resp = api_client.patch("/api/settings", json={"scrape_interval_minutes": "15"})
    assert resp.status_code == 200
    data = resp.json()
    warnings = data.get("warnings") or []
    assert warnings == []
