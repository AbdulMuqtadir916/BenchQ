"""Job search (docs/02 §6.y; docs/team/zuhair.md §2): a BDE searches jobs for their candidate.

- `providers/`  the job sources, one plug-in each (freehire.me first), behind one contract (`providers/base.py`)
- `http.py`     the one outbound call: timeout, one retry, a size cap, fixed error codes
- `country.py`  the candidate's résumé country to a search country
- `limits.py`   the daily caps, counted from rows since the last 6:30 PM IST
- `pipeline.py` one search: the provider, then `scrape_jobs` and `job_postings` in one transaction
The routes are backend/api/routes_job_search.py. The old JobNavigator scraper (backend/scraper/) is separate.
"""
