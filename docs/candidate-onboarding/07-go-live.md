# 07 — Go live: adapters and mappers

**Owner:** — · **Depends on:** 05, and 06's PRs 2–4 · **Branch:** `integrate/candidates`

Switch the feature from mocks to the backend, module by module, without touching a screen (CLAUDE.md: a swap never
rewrites a screen). Follow `docs/integration/README.md` "The workflow for one module"; `01-ledger.md` is the worked
example to copy.

Read first: `docs/integration/README.md`, `src/lib/api/http.ts`, `src/lib/api/dto/session.ts` (an existing mapper),
[06](./06-backend.md) §3–§5 and its saved sample responses.

## 1. What goes live, in order

| Adapter (`src/lib/api/`) | Endpoint (06) | Mapper (`src/lib/api/dto/`) | Live flag |
|---|---|---|---|
| `team.ts` — invite with `managerId`, `changeManager` | §3 | `session.ts` (members gain `manager_id`) | `session` (already live) |
| `session.ts` — `updateFirmSettings`, firm `bdeCapacity` | §3 | `session.ts` | `session` |
| `resume-parse.ts` — `parse` (multipart) | §4 | `resume-parse.ts` (from module 04, unchanged) | `candidates` |
| `candidates.ts` — `list`, `byId`, `create`, `update`, `reassign` | §5 | new `candidates.ts`: `BackendCandidateSchema` + `toCandidate()`; `toBackendCreateCandidate()` for the body | `candidates` |

- Live flag: add `candidates` to `NEXT_PUBLIC_LIVE_MODULES` handling (the same reader as `session`, `ledger`). Without
  it, everything stays on mocks.
- Multipart: `http.ts` is the only `fetch`; add a `postForm` there if it has none, not a second `fetch`.
- The parse adapter in live mode: hide "Try a sample" (README A1).
- Query keys stay firm-first (`[firmId, "candidates", …]`).
- **Ledger, two backend gaps found in 05b** (a backend change, so agree it with the backend owner first):
  1. `GET /ledger` gives a BDE only the entries they wrote (`own_scope`). "New assignments" and the handoff note need
     the ASSIGN entries about the BDE's own candidates too, which a manager or the OWNER wrote.
  2. There's no filter by entity: the candidate page and the dashboard card read the first 500 entries and filter in
     the browser. Add `?entity_type=candidate&entity_id=…` (and `?action=ASSIGN`) and use them in `ledgerApi`.

## 2. Mapper rules

- Every snake_case field maps to the docs/02 name; nothing snake_case leaves `src/lib/api/dto/`.
- If the backend's candidate contract differs from docs/02 (Zuhair owns it, Q50), **stop and ask**: either docs/02
  changes with product sign-off, or the mapper fills the gap. Never edit `src/lib/schemas/` to fit (CLAUDE.md).
- A response with a `VERIFIED` claim without an `evidenceId` is a mapping error: the mapper throws (Truth Guard).

## 3. Tests

- `src/lib/api/dto/candidates.test.ts` and `resume-parse.test.ts`, fed by real responses saved in
  `src/lib/api/dto/__samples__/` (from 06's sample).
- `live-candidates.test.ts` next to `live-session.test.ts`: the adapter picks the backend with the flag, mocks without.
- Manual, on `docker compose up -d db backend` and `pnpm dev` with `NEXT_PUBLIC_LIVE_MODULES=session,ledger,candidates`:
  the README §10 exit check, signed in as each seeded account; a second firm sees none of it.

## Done when

- [ ] All four adapters live behind the flag; screens unchanged (`git diff --stat` shows no `src/components` or `src/app` change)
- [ ] Mappers tested against real samples
- [ ] README §10 exit check passes on the backend
- [ ] `docs/integration/README.md` board updated; the candidates mock is deleted only when every candidate screen reads
      live (Track 03/04 still read candidates by id)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` clean
