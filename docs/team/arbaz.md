# Arbaz — Standalone BenchQ Apply Chrome Extension

## Overview

Manifest V3 Chrome extension with a React/TypeScript Side Panel. For the signed-in BDE it displays saved applications (the backend representation of a candidate/job favorite), opens the job's stored URL in a new tab, and marks a saved application as `applied` in BenchQ. It never submits a form to an employer.

All extension implementation is isolated in `extension/`, alongside the root `package.json` scripts for `ext:build` and `ext:watch`. Two root settings leave the extension's tooling out of the app's checks: `tsconfig.json` excludes `extension/vite.config.ts` and `eslint.config.mjs` ignores `extension/dist/`.

## Structure and technology

```text
extension/
├── public/manifest.json       MV3 side panel and service worker registration
├── src/
│   ├── api.ts                 Session, saved applications, and status API calls
│   ├── background.ts          Opens the panel from the toolbar action
│   ├── chrome.d.ts            Minimal Chrome API declarations
│   ├── JobHighlight.tsx       Selected-job card with Apply
│   ├── main.tsx               Side panel UI and session/job state
│   └── style.css              Compact BenchQ-inspired side panel styling
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
└── vite.config.ts
```

Uses React, TypeScript, Vite, and Chrome Side Panel API. Vite outputs to `extension/dist/`; the checked build produced `manifest.json`, `index.html`, `panel.js`, `background.js`, and CSS under `assets/`.

## Reused BenchQ behavior

- **Login and session:** the existing sign-in page is `/{firm}/sign-in` by route group resolution at `/sign-in`; the extension opens `${BENCHQ_URL}/sign-in` in a new tab. It does not render a login form or access HttpOnly cookies. Authenticated `fetch` calls use `credentials: "include"` and `/api/auth/me`, whose response contains `principal`, `user`, and `firm`.
- **Session after login/logout:** after Login is clicked, the open panel polls `/api/auth/me` every 2.5 seconds for up to two minutes; when the cookie session is available it reloads the candidate list and jobs. While signed in, it checks the session every 15 seconds and when the panel regains focus or visibility. A 401 clears the panel data and returns to sign-in; transient network errors leave the current session view intact. Refresh and retry controls are also provided.
- **BDE identification and isolation:** the extension requires `principal.kind === "firm"` and `principal.role === "BDE"`. It gets the BDE's candidate choices from `GET /api/firms/{firm_id}/candidates`, which the backend scopes to that BDE. The selected candidate ID is sent to the saved and applied application reads; the backend verifies candidate visibility again. References: `backend/api/routes_applications.py`, `backend/api/routes_candidates.py`, `backend/models/candidates.py` (`FavoriteJob` and `CandidateJob`), and `backend/models/db.py` (`Application`, `Job`).
- **Saved/favorite data:** in the candidate workflow, a saved application is the candidate/job favorite. `POST /api/applications` creates both the `FavoriteJob` and `Application(status="saved")`; it requires the job to be linked to that candidate. The extension lists these saved applications. The general Job Explorer's `JobMark` saved state remains a separate per-user frontend mock and is not what the candidate-scoped application endpoint reads.
- **Apply and applied state:** each saved job's stored URL opens the employer's posting. The `Apply` action calls `PATCH /api/applications/{id}/candidate-status` with status `applied`, the current revision, and a unique command id. Backend tracking removes the favorite when status moves away from `saved`. Separate Saved and Applied tabs show counts; applying moves the item to the Applied tab and disables its action. Saved-to-applied history is reloaded from the API after refresh.
- **Non-BDE:** displays the requested BDE-only explanation and no jobs.
- **Theme and identity:** the panel has an interactive Light/Dark toggle with the same Moon/Sun icon states as `src/components/theme/theme-toggle.tsx`; it remembers the selection in extension-local storage and uses BenchQ light and navy dark palette values. The signed-in header shows the user's name, BDE role, and firm.

## Build and setup

- `npm run ext:build` — builds the standalone extension.
- `npm run ext:watch` — rebuilds on source changes.
- Vite loads `BENCHQ_URL` from `extension/.env`; copy `extension/.env.example` as a starting point. It is the BenchQ web-app origin used for the sign-in tab and all `/api/*` requests. In local development it is `http://localhost:3000`; Next.js rewrites those API paths to the backend at `BACKEND_URL`. For another environment, set it to that BenchQ web-app origin, rebuild, and ensure the backend `ALLOWED_ORIGINS` includes the extension's exact `chrome-extension://` origin.
- Load unpacked in Chrome: run the build, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `extension/dist/`.

The extension calls the BenchQ origin directly with browser-managed cookies. Backend CORS and unsafe-request origin checks use `ALLOWED_ORIGINS`; the deployment must include the installed extension's `chrome-extension://<extension-id>` origin. This is an environment setup dependency, not changed by this implementation. The manifest declares HTTPS host access to allow a deployment origin; runtime access is still limited to the configured `BENCHQ_URL` in the API client.

## Verification and limitations

- **Build:** `npm run ext:build` completed successfully. The load-unpacked extension is in `extension/dist/`.
- **API and local test data:** 10 jobs from `src/mocks/data/jobs.json` are linked to five candidates in the same firm: three candidates assigned to Adnan Khan and two assigned to Sneha Rao. Each has two saved jobs. The APIs returned six saved jobs for Adnan before applying one; `PATCH .../candidate-status` returned `applied` at revision 1; subsequent reads returned five saved plus one applied for Adnan and four saved for Sneha. The applied item remains visible with a disabled action. The BDE candidate filter was confirmed by the API results.
- **Runtime:** the side panel was not exercised in Chrome; load unpacked from `extension/dist/`. The extension uses the configured `BENCHQ_URL`, and the backend must allow the extension origin in `ALLOWED_ORIGINS`.
- **CORS:** runtime calls will fail unless the deployment allowlists the extension origin as described above. Backend CORS configuration was intentionally not modified.
- **Chrome packaging:** Vite output is load-unpacked output; no store package or signing was produced.
