# Activity Log PR 6: sign-in events and the Super Admin's Activity page

Branch: `activity-logs/pr6-signin-events-and-super-admin`, built on `activity-logs/pr5-part3-cover-letters`.
Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).

## Scope

- Logs sign-out for everyone, and failed sign-ins and lockouts. Nothing stored failed sign-ins before: only an in-memory
  counter, which a restart clears.
- Failed sign-ins and lockouts are the Super Admin's alone. Every firm reader, a support view included, is refused them.
- The Super Admin's sidebar says Activity, and the page reads every entry on the platform, with paging, search, a
  calendar, and actor and candidate filters. `/admin/audit` keeps its address.
- Password-reset requests were already logged, and each AI call's model, tokens and cost are already in `llm_call_log`,
  so this PR adds neither.

## How failed sign-ins are stored

| Case | Row |
|---|---|
| Known account | On that person, in their firm, with the reason: wrong password, account deactivated, or password reset in progress |
| Email with no account | Actor "Unknown account", no firm, the email masked as `ab***@mail.com` |
| Repeat tries | Same account and IP within 10 seconds of the row's first try: one row, `attempt_count` goes up, and Activity shows "Name (3)" |
| A limit used up | One `LOCKED_OUT` row: 5 tries on an account in 15 minutes, or 10 tries from an IP in a minute |

Tries refused while locked (429) are not logged. Sign-in answers are unchanged: the same 401 for every failure.

`ip_address` is stored on these rows and is in no list response. `GET /api/admin/activity/{id}/ip` returns it for one row,
behind the Show IP button. It comes from `throttle.client_ip`, which the rate limits already used. It reads the forwarded
address for the proxies counted in `TRUSTED_PROXY_HOPS`, so that setting must match production or every row will show the
proxy's address. Locally every row shows Docker's address.

## Files changed

| File | Changes and reason |
|---|---|
| `backend/migrations/versions/0020_activity_sign_in_events.py` | New actions, the UNKNOWN actor, `ip_address`, `attempt_count`. The append-only trigger now allows one UPDATE: adding 1 to a failed sign-in's count, with every other column unchanged. Downgrading removes these rows, which have no place in the older log. |
| `backend/models/tenancy.py` | The columns and action lists. `ledger_entries` keeps its own list. |
| `backend/auth/ledger.py`, `backend/auth/throttle.py`, `backend/api/routes_auth.py` | Writing the entries. `record_failure` says when a limit is used up. |
| `backend/api/routes_ledger.py` | `_visible` leaves out failed sign-ins for every firm reader. `people_in_view` and the `Filters` time zone are shared with the Super Admin's routes. |
| `backend/api/routes_admin_activity.py`, `backend/auth/access.py`, `backend/main.py` | The Super Admin's log. Days are IST. |
| `src/features/admin/activity/*`, `src/lib/hooks/use-admin-activity.ts`, `src/lib/api/platform.ts`, `src/lib/api/dto/*`, `src/lib/schemas/analytics.ts` | The page, its people list and the Show IP button. Replaces `audit-page.tsx`. |
| `src/features/activity/*` | `activity-table.tsx` and `RailFrame` are shared by both pages. The Actor column adds the try count. |
| `src/lib/routes/registry.ts`, `docs/04-SCREENS.md` | The sidebar label. |

## Known limits

- A firm's Overview and Activity tabs and the admin Overview still read `/api/admin/audit`, the newest 500 entries.
- Unknown-account tries from one IP share a row for 10 seconds, whichever email was typed, and the row shows the first.
  The IP limit of 10 tries a minute is what stops a flood, so one IP can write at most 6 such rows a minute.
- On the Whole platform view, Show IP can need a sideways scroll. The Failed sign-ins view has room for it.
