# Activity Log PR 6: sign-in events and the Super Admin's Activity page

Branch: `activity-logs/pr6-signin-events-and-super-admin`, built on `activity-logs/pr5-part2-jobs-and-analysis` (PR 5 part 3, cover letters, is dropped).
Owner: Mohammed Abdul Ahad Umamah ([umamah.md](../umamah.md)).

## In plain words

Until now the log held what people did, but not when someone signed out, mistyped a password or got locked out. This PR
logs all three, and gives the Super Admin (BenchQ staff) a full Activity page across every firm, with a **Failed
sign-ins** view that only they can see. Firms never see failed sign-ins, not even the Owner or a support view. The
address a try came from (IP) is kept but is never in a list; the Super Admin opens it one row at a time.

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
| `backend/migrations/versions/0029_activity_sign_in_events.py` | New actions, the UNKNOWN actor, `ip_address`, `attempt_count`. The append-only trigger now allows one UPDATE: adding 1 to a failed sign-in's count, with every other column unchanged. Downgrading removes these rows, which have no place in the older log. |
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

## The Super Admin's own operations (added 2026-11-12)

The Super Admin's Activity page is the record of everything on the platform, but their own operations were not in it:
changing settings, creating, changing and deleting searches and companies, running scrapes, backups and cleanups, and
the Telegram and LinkedIn controls. These 30 routes now each write one entry (no firm, the Super Admin as the actor,
`PLATFORM_ADMIN`) **after the route succeeds**. A route that fails writes nothing.

- **How:** a small dependency on each route, `logs_platform_action(...)` in `backend/auth/platform_actions.py`. The route
  bodies are untouched.
- **What an entry says:** what was done, the id from the path, and for a change the *names* of the fields in the request
  ("Changed settings: scrape_interval_minutes."). Never the values (a setting can hold a key or a token) and never the body.
- **Actions:** `CREATE`, `UPDATE` and `DELETE` for records; `STATE_CHANGE` for starting or running something.
- **Not logged:** Telegram's inbound webhook (Telegram calling in with its own secret: no signed-in person).
- **Checked by CI:** the route rules from PR 2 now accept this form, so a new Super Admin route that logs nothing fails
  the build, as any other write route does.

## Edge cases and fixes (2026-11-12)

- **Two failed tries at the same instant.** The "tries from one IP within 10 seconds share a row" rule locked an existing
  row, but two tries arriving together found no row and both added one. A database lock per account and IP (per IP for
  unknown accounts, as they share a row by IP) makes the second try wait for the first and count on its row. Two tests
  use two real sessions and fail without the lock.
- **Candidate names** in the Super Admin's log and its candidate list come from each candidate's résumé, one firm at a
  time (07 Q57), since main moved names off `candidates`.
- **Same moment and day edges** behave as in the firm's log (newest first, then lowest id), but the Super Admin's days are
  cut in IST.
- **A candidate with no name** shows "Unnamed candidate", as on the firm's screen.
