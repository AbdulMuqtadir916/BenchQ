# Module 04 — Resumes and AI tailoring

**Difficulty:** Hard · **Depends on:** 02 live (tailoring needs backend job IDs)
**Module names:** `resumes`, `agents` · **Product decision that shapes it:** D4 (claim evidence)

This is the product's centerpiece: AI drafts land `UNVERIFIED`, a human verifies, and the export
gate blocks until every claim is clean. Do it in phases; each phase is its own PR.

**Every LLM call reads its model and prompts through `ai_config("tailoring")` / `ai_config("scoring")`**
(`backend/ai/config.py`), never `settings` directly, so the Super Admin's AI presets plug in later without a
rewrite ([08-ai-presets.md](./08-ai-presets.md)). Output formats stay in code.

## What exists today (read before planning)

- **The studio never calls the API to tailor.** `src/components/app/resume-studio/tailor-run.tsx`
  hardcodes the "tailored" summary and bullets inside the component and animates fake progress
  with `useAgentRun` (`src/components/app/ai/use-agent-run.ts`, random timers plus a 5% fake
  failure). `agentsApi.tailorResume` is only used by the design-system showcase.
- **The job-detail "analysis"** (`src/app/(app)/jobs/[id]/page.tsx`) uses the same fake
  `useAgentRun`.
- **Edits are never saved.** The studio keeps the document in a Zustand store
  (`resume-studio/studio-store.ts`). `resumesApi` has no update call, so a reload loses edits.
- **How the studio loads:** `open-resume.tsx` → `useResume(id)` + `useCandidate` + `useRecord` →
  `buildResumeDocument(resume, candidate, record)` (`src/lib/resume-doc/build.ts`) →
  `ResumeDocument` (`src/lib/schemas/resume-document.ts`). Frontend `Resume` →
  `versions[]` → `claims[]` reference bullets in the candidate's evidence **record**.

## Backend surface

| Purpose | Endpoint | Source |
|---|---|---|
| List | `GET /api/resumes?is_base=<bool>` → `[Resume]` (no `json_data`) | `list_resumes` in `backend/api/routes_resumes.py` |
| Detail | `GET /api/resumes/{id}` → `Resume` with `json_data` | same file |
| Save | `PATCH /api/resumes/{id}` | same file |
| Tailor | `POST /api/resumes/tailor` `{ base_resume_id, job_id }` → **202** `{ run_id, status: "running", chain_score }`; `409` if that pair is already running | `tailor_resume`, same file |
| Run status | `GET /api/monitor/run/{run_id}` → `{ id, job_type, status, started_at, finished_at, duration_seconds, result_summary, error, meta }` | `get_run_detail` in `backend/main.py` |
| PDF | `GET /api/resumes/{id}/pdf?template=<id>&format=letter|a4` | same file |
| Job analysis | `POST /api/analyze/{job_id}?depth=light|full` → 202 + run | see `docs/archive/BACKEND_API_FEATURES.md` §12 |

Backend resume (`_resume_to_dict`): `id, name, is_base, parent_id, job_id, template, page_format,
created_at, updated_at` (+ `json_data` on detail). `json_data` holds `header`, `summary`,
`experience[]` (company / title / location / dates / `bullets[]`, and on tailored copies
optionally `suggested_bullets[]`), `education`, `skills`. Capture real samples; the shape is
flexible JSON.

Run `status` goes `running` → `completed` | `failed` (confirm the exact terminal values against
`backend/job_monitor.py` and your samples).

---

## Phase 0 — Design review (required, no code)

The backend stores a self-contained resume document; the frontend models resumes as versions whose
claims point at an evidence record the backend doesn't have. Before coding, add a "Design" section
to this file choosing one of these and get the product owner's sign-off:

- **(A) Map into the existing model.** Synthesize one `ResumeVersion` per backend resume
  (`latestVersionId = "<id>:v1"`) and turn `json_data` into `claims`. No component changes, but
  `buildResumeDocument` still expects a record and will need a fallback.
- **(B) Recommended: map straight to `ResumeDocument`.** Add `buildResumeDocumentFromBackend()` in
  `src/lib/resume-doc/` and have `open-resume.tsx` use it when `resumes` is live. One component
  changes; no fake records or versions. Requires approval because it touches a screen.

## Phase 1 — Read resumes

- [ ] Samples: `/api/resumes`, one base and one tailored `/api/resumes/{id}` → `__samples__/resumes.json`
- [ ] `dto/resumes.ts`: `BackendResumeSchema` (with optional `json_data`) + mapper per the chosen design
- [ ] Mapping basics: `isMaster ← is_base`, `targetJobId ← job_id`, `templateId ← template`,
      `name ← name`, `candidateId ←` the interim default candidate from Module 03 (D1)
- [ ] **Every claim from the backend is `UNVERIFIED` with `evidenceId: null`.** The backend has no
      evidence, and `CLAUDE.md` forbids `VERIFIED` without an `evidenceId`. So the export gate will
      block backend resumes until D4 is decided. That's correct behaviour — don't work around it
- [ ] Resume library (`src/app/(app)/resumes/page.tsx`), candidate "Resumes" tab and the studio
      open backend resumes

## Phase 2 — Real tailoring

- [ ] `src/lib/hooks/use-backend-run.ts`: `useBackendRun(runId)` polls `/api/monitor/run/{id}`
      every 1.5 s (TanStack `refetchInterval`), stops on a terminal status, and exposes
      `{ status, error, elapsedMs }`
- [ ] `agentsApi.tailorResume` (live): `POST /api/resumes/tailor` → return the `run_id`; when the
      run completes, fetch the tailored resume (`GET /api/resumes?is_base=false`, newest with the
      same `job_id`; check whether `run.meta` names it directly) and map its new or changed bullets
      and `suggested_bullets` to `UNVERIFIED` claims. Reshape `AgentDraft` / `useTailorResume` as
      the design needs — the input now needs a **backend base resume id + job id**
- [ ] `tailor-run.tsx`: delete the hardcoded drafts; drive `AgentRunPanel` from the real run. While
      `running`, the stage labels may keep advancing cosmetically, but completion and failure come
      only from the backend. `409` → "Already tailoring this resume for this job"; `failed` → the
      existing fallback message
- [ ] Keep `useAgentRun` only for mocked mode. Delete it once `agents` is fully live

## Phase 3 — Save, export, job analysis (separate PRs)

- [ ] `resumesApi.update` + `useUpdateResume` → `PATCH /api/resumes/{id}`, so studio edits survive
      a reload (debounced autosave or an explicit Save — ask the UI owner)
- [ ] Export: `GET /api/resumes/{id}/pdf`. The UI's export gate stays in front of it, unchanged
- [ ] Job-detail analysis: `POST /api/analyze/{job_id}` + `useBackendRun`, then invalidate
      `["job", id]` so the new `cv_scores` load

## Gaps (write new ones here)

- **D4 — Claim evidence.** Without an evidence store, nothing can become `VERIFIED`, and
  verification clicks can't persist. See `06-open-decisions.md`.
- **D6 — Inline rewrite** (`agentsApi.rewrite`: improve / concise / quantify / grammar) has no
  backend endpoint. It stays mocked.
- **ATS and keyword scores:** `ResumeVersion.atsScore` / `keywords*` have no direct backend
  source. `POST /api/resumes/{id}/score-check` is the closest — evaluate it in Phase 3.

## Acceptance criteria

- [ ] Studio opens backend resumes; claims render `UNVERIFIED`; the export gate names the count
- [ ] Tailoring against a backend job runs for real: progress, completion, drafts land
      `UNVERIFIED`; a backend failure shows the fallback; cancel/close doesn't leave a stuck panel
- [ ] No hardcoded AI text left in components; no `SCHEMA_MISMATCH`; mocks for each finished phase
      deleted; checks green
