# Synthetic Inbox correction acceptance

This development-only harness imports the actual Inbox, application drawer, progress and query hooks. It does not add an application route, connect Gmail, classify real mail or mutate development records. Python Playwright intercepts every API request and returns synthetic fixtures. It uses the installed Vitest/Vite, React, axe and backend Playwright runtimes; no dependency changes are required.

Start from the repository root:

```sh
QA_HOST=0.0.0.0 node scripts/qa/inbox-corrections/serve.mjs
```

In a second terminal (the existing backend image provides Playwright/Chromium):

```sh
docker compose cp node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/axe.min.js backend:/tmp/axe.min.js
docker compose exec -T -e QA_URL=http://host.docker.internal:4178 backend python - < scripts/qa/inbox-corrections/verify.py
```

Use the installed axe version/path if the lockfile changes. Run on the local computer with `QA_URL=http://127.0.0.1:4178 QA_AXE_PATH=<installed axe.min.js> python verify.py` when Python Playwright/Chromium are available there. Stop the harness with Ctrl+C when done. Screenshots remain under `/tmp/correction-{theme}-{width}.png` in the browser runtime. API 503/404 cases are deliberate assertions, not ignored test failures.

Checks include cached/rapid selection without collection/application requests or list removal, per-email form state, exact old/missing links, Back/Forward, selection outside an active filter, read rollback/retry, processing refresh/poll stop, read-only controls, skeleton/empty/error states, all eleven status presentations, drawer Tab/Shift+Tab/Escape focus, overflow, reduced motion and axe in light/dark at 1440/1024/390.

The harness supplies small Next navigation/link adapters so the real components can run outside the application shell. It verifies component integration and native history behavior; it does not replace full Next route/authentication smoke checks or separately authorized live-provider acceptance. Backend F7/API tests establish permissions independently of the UI. `QA_BASELINE_HOOK=/absolute/path/to/old-use-inbox.ts QA_PORT=4179` with `QA_BASELINE=1 QA_URL=http://host.docker.internal:4179` reproduces the original collection refetch, list removal and lost form selection.

## Actual Next route smoke

After the isolated production build, start that checkout with `BACKEND_URL=http://localhost:8000 node_modules/.bin/next start --hostname 0.0.0.0 --port 3002`. On a local database containing the documented demo seed:

```sh
docker compose cp src/lib/api/dto/__samples__/candidates.json backend:/tmp/benchq-candidate-sample.json
docker compose exec -T backend python - < scripts/qa/inbox-corrections/verify-next-route.py
```

This signs into the documented demo Owner with the public seed password and signs out in `finally`. Authentication/session audit records are the only intended database writes. The candidate is the public `cand_06` fixture; Inbox/application/job responses are synthetic, and unexpected browser mutations are refused. Remaining read requests go through the existing backend authorization. It checks the real Next native history integration, no Inbox refetch or RSC request during cached selection, Back/Forward, stable list identity and no JavaScript page exceptions. Only localhost/Docker-host targets are accepted. Override `QA_NEXT_URL`, `QA_BACKEND_URL` and `QA_CANDIDATE_SAMPLE` for equivalent local setups. Stop the temporary production server after use. Dev HMR rejects an unapproved Docker hostname; using the production build avoids weakening the application's origin protection.
