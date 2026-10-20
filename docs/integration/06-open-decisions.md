# 06 — Open decisions (for the product owner)

The backend (JobNavigator) is built for **one job-seeker**. BenchQ is a **multi-tenant staffing
tool**: firms, BDEs, many candidates, and evidence-backed claims. The decisions below can't be made
by an integrating developer. Until each is made, the listed screens stay on mock data (their mocks
in `src/mocks/` are **not** deleted) or use the stated interim.

Each decision: what the frontend needs → what the backend has → options → a recommendation.

> **2026-10-21:** the auth + tenancy plan ([`07-auth-and-tenancy.md`](./07-auth-and-tenancy.md) §2)
> updates the recommendations for D1–D4 (D2 is now: users, firms and roles in FastAPI) and adds a new
> one: scraped jobs as a shared pool. Record the answers in the log below.

---

## D1 — Candidates

- **Frontend needs:** many candidates per firm, each with profile, work authorisation, rates,
  assigned BDEs and an answer bank. Almost every screen filters by `candidateId`.
- **Backend has:** one `Persona` singleton (`GET /api/persona`): contact, work_auth, compensation,
  preferences, resume_content, and a `qa_bank` very close to the frontend's answer bank.
  Applications and resumes carry no candidate.
- **Options:**
  1. Add a `candidates` table and a `candidate_id` on applications, resumes and searches in the
     backend. Persona becomes "a candidate". Largest change, but it's the real product.
  2. One backend deployment per candidate. Operationally heavy, kills cross-candidate views.
  3. Interim: every live application/resume belongs to one configured mock candidate
     (`NEXT_PUBLIC_DEFAULT_CANDIDATE_ID`). That's what Modules 03/04 do today.
- **Recommendation:** 3 now, plan 1. Candidates screens stay mocked.
- **Mock stays:** `src/mocks/candidates.ts`, `candidates.json`.

## D2 — Users, roles and firms (auth)

- **Frontend needs:** sign-in per person, firm, roles OWNER / MANAGER / BDE / VIEWER, seat limits,
  "who did what".
- **Backend has:** one shared API key. No users, firms or roles.
- **Options:** (1) add users/firms/roles to the backend; (2) put an identity provider in front and
  pass the user to the backend; (3) interim: shared key, roles stay a client-side switcher.
- **Recommendation:** 3 for the demo/pilot; decide 1 vs 2 before any second firm uses it.
- **Mock stays:** `src/mocks/team.ts`, `session.ts`, `firm.json`, `src/lib/stores/session-store.ts`.

## D3 — Application statuses

- **Frontend has 10:** SAVED, APPLIED, RESPONSE, SCREENING, INTERVIEW, OFFER, PLACED, REJECTED,
  WITHDRAWN, EXPIRED.
- **Backend has 4:** applied, interview, offer, rejected (`VALID_STATUSES` in
  `backend/api/routes_applications.py`). Its email monitor and auto-reject scheduler
  (`backend/email_monitor/`, `backend/scheduler.py`) write these values.
- **Options:** (1) extend the backend to the 10 (the column is a free string; audit the email
  monitor, auto-reject and `/api/stats` for assumptions); (2) collapse the frontend board to 4;
  (3) interim: the frontend refuses moves to unsupported statuses (Module 03 does this).
- **Recommendation:** 1. The 10 stages are bench-sales vocabulary. Until then, 3.

## D4 — Claim evidence and verification (the core product rule)

- **Frontend needs:** a per-candidate evidence record; claims marked VERIFIED only with an
  `evidenceId`; the export gate blocks while any claim is UNVERIFIED; verifications persist.
- **Backend has:** nothing equivalent. Resumes are free JSON; tailoring adds `suggested_bullets`.
- **Consequence today:** every backend resume opens with all claims UNVERIFIED and **can't be
  exported**, and verifying in the UI isn't saved.
- **Options:** (1) add `evidence` + `claims` tables (claim → resume, state, evidence_id, actor,
  reason) and endpoints to verify/override; (2) store claim states inside resume `json_data`
  (fast, but no audit trail or evidence objects); (3) temporarily let the base resume's claims
  count as VERIFIED — **forbidden** by `CLAUDE.md`. Don't.
- **Recommendation:** 1. This is BenchQ's differentiator and needs an audit trail (it feeds the
  ledger too).
- **Mock stays:** `src/mocks/records.ts`, `records.json`.

## D5 — Follow-ups

- **Frontend needs:** follow-up tasks per application (kind, due, state, assignee) for
  `/followups` and the dashboards.
- **Backend has:** `next_action` + `next_action_date` on each application; Telegram digests.
- **Options:** (1) derive one follow-up per application from `next_action*` (read-only, a cheap
  win); (2) a real follow-up table with states.
- **Recommendation:** 1 as a small module after 03; 2 if snooze/complete must persist.
- **Mock stays:** `followupsMock` in `src/mocks/applications.ts`, `followups.json`.

## D6 — Inline AI rewrite

- **Frontend needs:** improve / concise / quantify / grammar on selected resume text
  (`agentsApi.rewrite`).
- **Backend has:** no such endpoint (it has tailoring, cover letters and autofill answers).
- **Options:** add `POST /api/resumes/rewrite` reusing the backend's LLM settings, or keep it
  mocked.
- **Recommendation:** add it after Module 04 Phase 2 — it reuses the same LLM plumbing.

## D7 — Candidate documents

- **Frontend needs:** upload, list and remove candidate documents with share links.
- **Backend has:** no file storage (only resume PDF import, which parses, not stores).
- **Recommendation:** needs storage (S3-compatible or local volume) plus a small table. Decide
  after D1.
- **Mock stays:** `src/mocks/documents.ts`, `documents.json`.

## D8 — Per-candidate inbox

- **Frontend needs:** each candidate connects a Gmail account; messages appear on the candidate.
- **Backend has:** one Gmail account monitored to auto-update application statuses
  (`backend/email_monitor/`, `POST /api/email/check-now`).
- **Recommendation:** after D1 — per-candidate OAuth tokens are a security-sensitive feature, so
  design it properly.
- **Mock stays:** `src/mocks/inbox.ts`, `inbox.json`.

## D9 — Job requirements and work-authorisation rules

- **Frontend needs:** `job.requirements[]` and `job.allowedWorkAuth[]` for match scoring, the
  requirement matrix and the work-auth hard filter.
- **Backend has:** `scoring_report` (LLM fit analysis), `h1b_jd_flag`, `h1b_jd_snippet`,
  `h1b_verdict`.
- **Options:** (1) have the backend's analyzer also extract structured requirements and work-auth
  rules; (2) derive approximately in the frontend mapper from `h1b_*`; (3) ship empty (Module 02
  does this).
- **Recommendation:** 1 — the analyzer already reads every JD.

---

## Decision log

Record each decision here, with date and owner, then update the affected module files.

| # | Decision | Date | Owner |
|---|---|---|---|
| D1 | | | |
| D2 | | | |
| D3 | | | |
| D4 | | | |
| D5 | | | |
| D6 | | | |
| D7 | | | |
| D8 | | | |
| D9 | | | |
