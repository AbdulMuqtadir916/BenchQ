"""PR 4 T2.5 (DEBUG D-20): server counts use exactly the list's scope."""
from collections import Counter

from backend.tests.test_pr3_matching import matching_case, mailbox_case, email  # noqa: F401 (fixtures)


def test_counts_match_the_list_for_the_firm_and_for_one_candidate(test_db, matching_case, api_client):
    candidate, _, app, _, _ = matching_case
    for params in ({}, {'candidate_id': str(candidate.id)}):
        listed = api_client.get('/api/applications', params={**params, 'limit': 2000})
        counted = api_client.get('/api/applications/counts', params=params)
        assert listed.status_code == counted.status_code == 200, counted.text
        body = counted.json()
        assert body['total'] == listed.json()['total']
        assert body['by_status'] == dict(Counter(a['status'] for a in listed.json()['applications']))
    assert counted.json()['by_status'].get(app.status) == 1
