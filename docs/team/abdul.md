# Abdul — Candidate core, then Billing, then Deployment, then cleaning the project

Read first: [team README](./README.md). You approve every change to `candidates` and every rename or removal of a
column anywhere (README §4).

## 0. Candidate core tables (before everyone)

[00-candidate-core.md](./00-candidate-core.md): migration 0007, the tables and constraints, tests. Merge it, then
tell Samad, Zuhair and Uzair to start.

## 1. Billing layer

Today plans and seats are UI-only (`plans`, the firm's copied limits, BDE seats and the candidate limit, 07 Q16–Q21,
Q44–Q45); there are no payments, and the frontend must not build them (CLAUDE.md). To decide before building:
provider (Stripe or a local one for India), per-seat or per-plan pricing, trials, what happens to a firm that stops
paying (Q28's suspended state already exists), invoices and GST. Then: a contract in `docs/02` (subscriptions,
invoices, payment events), the backend tables and webhooks, the Super Admin's view, the OWNER's billing page.

## 2. Deployment

Hosting for the frontend and the backend, the database (managed Postgres, backups, point-in-time restore), secrets,
domains and TLS, CI/CD from `main`, staging and production environments, the migration step on deploy (`start.sh`
already runs `db_upgrade`), monitoring. Coordinate with Uzair's production layer (health checks, worker count).

## 3. Cleaning the project dump

Once the tracks are live: delete each module's mock and fixtures (`src/mocks/*`, `NEXT_PUBLIC_LIVE_MODULES` and
`src/lib/api/config.ts` once everything is live), `activity_log_v2`, the JobNavigator leftovers no track uses, old
docs (`docs/archive/`), and regenerate `docs/CURRENT_STATE.md`.
