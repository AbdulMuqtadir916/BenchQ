# Module 01 — Ledger, the worked example

**Owner:** Abdul · **Depends on:** F1–F4 · **Module name:** `ledger` · **Status:** live behind flag

The ledger is the firm's record of who did what. It is the first module on the real backend, and it is
built to be copied: every firm-scoped module takes the same steps, in the same files. Read this before
you start your own track, and point to the step you're on in your PR.

The ledger is the `ledger_entries` table (the contract's `LedgerEntry`, docs/02 §10). It is **not**
`activity_log_v2`: that's the platform's system log (scrapes, scoring runs), with no actor, firm or action,
and it stays Super Admin only for `/admin/system` (07-auth §6.6).

---

## The whole chain, file by file

| Step | File | What it does |
|---|---|---|
| 1. Table | `backend/models/tenancy.py` `LedgerEntry`, migration 0003 | `firm_id` (null only for platform events, A13), actor, entity, action, summary. CHECK constraints, not enums; RESTRICT foreign keys (Q38) |
| 2. Write | `backend/auth/ledger.py` `record()` | Every write a person makes calls it **in the same transaction** as the change; the caller commits |
| 3. Read route | `backend/api/routes_ledger.py` | `GET /api/firms/{firm_id}/ledger?limit&offset` |
| 4. Access class | `backend/auth/access.py` `ROUTE_ACCESS` | `F`: firm users, and a Super Admin inside a support view of the firm for GET only; a Super Admin without one and a suspended firm's users are refused before the route runs |
| 5. Firm scoping | `backend/auth/scoping.py` `reader_firm_id`, `scoped()`, `own_scope()` | The firm comes from the session, never the request; the path's firm must equal it, or 404 |
| 6. Lint | `backend/tests/test_firm_scoping_lint.py` | Fails any route that queries a firm-owned model without `scoped()` |
| 7. Backend tests | `backend/tests/test_ledger.py`, `backend/tests/ledger_support.py` | Each role's view, BDE own scope, paging, another firm 404, Super Admin 403, signed out 401, a write shows up |
| 8. Serializer | `backend/auth/serialize.py` `ledger_entry_json` | The frontend's type in snake_case |
| 9. DTO + mapper | `src/lib/api/dto/session.ts` `LedgerEntryDto`, `toLedgerEntry` | Parses the wire shape, maps ids (`fromBackendId`) and timestamps (`toIso`) |
| 10. Adapter | `src/lib/api/analytics.ts` `ledgerApi` | The live branch behind `isLive("ledger")`; the firm id goes out through `toBackendId` |
| 11. Adapter test | `src/lib/api/live-ledger.test.ts` | URL and query, mapping, empty, error |
| 12. Screen | `src/app/[firm]/(app)/(manage)/ledger/page.tsx` | **Unchanged.** It already handled skeleton, empty and error |

The ledger's DTO sits in `dto/session.ts` because `/admin/audit` uses it too. A new module creates
`src/lib/api/dto/<module>.ts`.

---

## The backend, step by step

### The route

```python
@router.get("/ledger")
def list_ledger(firm_id: uuid.UUID, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                principal: Principal = Depends(current_principal), my_firm: uuid.UUID = Depends(reader_firm_id),
                db: DbSession = Depends(get_db)):
    if firm_id != my_firm:
        raise HTTPException(status_code=404, detail="Not found.")      # never confirm another firm exists
    entries = scoped(db, LedgerEntry, my_firm)                         # firm_id = :firm, always
    if (actor := own_scope(principal)) is not None:                    # a BDE: only their own rows
        entries = entries.filter(LedgerEntry.actor_user_id == actor)
    entries = entries.order_by(LedgerEntry.created_at.desc(), LedgerEntry.id).offset(offset).limit(limit)
    return [ledger_entry_json(e) for e in entries]
```

The rules it follows, which every track follows:

- **The firm comes from the session.** `reader_firm_id` (reads) and `writer_firm_id` (writes) are the only
  sources. A firm id in a path or a body is checked against it, never trusted.
- **Another firm's row is 404,** the same as a missing one (principle 4). Never 403, which would confirm it exists.
- **Every firm-owned query goes through `scoped()`** (or `scoped_jobs()` for the shared job pool). If a
  function truly must see every firm (a platform route, a background worker given ids its route already
  checked), add it to `ALLOWED` in the lint with the reason. The reviewer reads that list.
- **`own` scope is enforced on the server.** A BDE reads only their own work (07 §2.2): add
  `<owner column> == own_scope(principal)` when it isn't None. The frontend's `scopeLedger` /
  `scopeApplications` apply the same rule for UX only.
- **Every new endpoint gets a `ROUTE_ACCESS` line.** `test_access.py` fails on a route without one.
- **Ordering is stable:** a timestamp plus the id, so paging never repeats or skips a row.

### Writes log to the ledger

Each track logs its own writes. Nothing is backfilled:

```python
ledger.record(db, actor=actor, action="CREATE", entity_type="candidate", entity_id=candidate.id,
              entity_label=candidate.name, summary=f"Added {candidate.name}", firm_id=firm_id)
db.commit()                                                           # the change and its entry together
```

- `action` is one of `LEDGER_ACTIONS` (`backend/models/tenancy.py`, the contract's list). A new action
  is a contract change: ask first.
- `entity_type` is lowercase (`candidate`, `application`, `resume`; 07 Q30).
- `summary` is the sentence the ledger screen shows: who and what, never a raw id.
- AI runs log `AI_GENERATE` with `actor_type` `AGENT`, `model_id` and `prompt_version` (track 04).

Every write test checks its entry:

```python
from backend.tests.ledger_support import assert_logged

entry = assert_logged(test_db, action="CREATE", entity_type="candidate", entity_id=body["id"],
                      firm_id=accounts.firm_id, actor_user_id=accounts.user_id)
assert entry.summary == "Added Priya"
```

### Backend tests

Copy `backend/tests/test_ledger.py`'s list of cases. For a firm-scoped read:

- each role sees what the policy says (OWNER, MANAGER, BDE, VIEWER);
- a BDE's `own` scope, if the module has one;
- paging and its limits (422 past the max);
- another firm's id is 404, and so is a missing one;
- a Super Admin is 403 without a support view, reads inside one, and is 403 on every write; signed out is 401;
- the response keys match the frontend's type exactly.

Sign in other roles with `make_user` + `start_session` and send the cookie (see `_session_for` in the
test). Run with `python -m pytest backend/tests -q -o asyncio_mode=auto -m "not live"` (README, "Running
locally").

---

## The frontend, step by step

```ts
// src/lib/api/analytics.ts
const live = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }) =>
    (await http.get(`/api/firms/${toBackendId(firmId)}/ledger`, arrayOf(LedgerEntryDto), { query: params })).map(toLedgerEntry),
};

export const ledgerApi = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }): Promise<LedgerEntry[]> =>
    isLive("ledger") ? live.list(firmId, params) : (await mock()).list(firmId, params),
};
```

- **The firm id is the URL's.** The hook reads it from firm context (`useFirmId`) and the query key starts
  with it. The adapter translates a seeded demo firm's fixture id to its backend UUID with `toBackendId`;
  the mapper translates ids back with `fromBackendId` (`mapId`), so the modules still on mocks keep
  finding their rows.
- **The backend's shape stops at the DTO.** No snake_case past `toLedgerEntry`, and the result is parsed
  by the frontend's own `LedgerEntrySchema`.
- **The screen doesn't change.** If it would have to, stop and ask (CLAUDE.md).
- **The mock stays** until F6 makes live the default. Then the `isLive` branch, `src/mocks/ledger.ts` and
  `src/mocks/data/ledger.json` are deleted together.

### Try it

The ledger is always the backend's (F6): no switch. Start the backend, seed the demo accounts, `pnpm dev`,
sign in at `http://localhost:3000` and open `/<firm>/ledger`.

- An OWNER sees sign-ins and invites (the events the backend records today).
- A BDE sees only their own entries (their own sign-ins).
- Stop the backend and retry: the error state, then recovery.
- A seeded firm's mock ledger entries are not on the backend. The live ledger shows only real events.

---

## Gaps

- **Only auth and invite events so far:** `LOGIN`, `FIRM_CREATED`, `INVITE_SENT`, `INVITE_ACCEPTED`,
  `INVITE_REVOKED`, `ADMIN_ACCESS`, `ADMIN_ACCESS_END`. The ledger fills up as each track logs its writes.
- **No claim states or evidence** until track 04, so that column shows "—".
- ~~**Super Admin reading a firm's ledger**~~ Done (issue #56): inside a support view the Super Admin reads the
  viewed firm's whole ledger; `/admin/audit` shows every firm's entries.
- **AI runs are logged elsewhere** today (`JobRun`, `llm_call_log`). Track 04 writes `AI_GENERATE` entries.
- The screen renders `modelId · promptVersion`. A row with a model and no prompt version shows a dangling
  "·". Track 04 must always send both.
- The page asks for the newest 100 entries. Paging past 100 comes with the screen's own filters.

## Acceptance criteria

- [x] `GET /api/firms/{firm_id}/ledger`: the firm's entries, newest first; a BDE's own only; another firm 404
- [x] `ledger_entries` covered by the scoping lint
- [x] Adapter live behind `ledger`, mapping tested; screen unchanged
- [ ] Clicked through as OWNER and BDE on the live backend (the PR's test plan)
- [ ] Mock deleted (with F6)
