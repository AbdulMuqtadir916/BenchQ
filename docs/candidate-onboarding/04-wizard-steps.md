# 04 — The wizard, steps 1–4

**Owner:** — · **Depends on:** 01 · **Branch:** `feat/onboarding-04-wizard`

> **Built 2026-10-27** behind `NEXT_PUBLIC_CANDIDATE_WIZARD` (the flag is gone since module 05a), with these notes for
> module 05:
> - **The step is changed with `history.replaceState`, not `router.replace`.** Next keys a page by its search params,
>   so a router navigation remounts the page and loses everything entered (found in the browser check).
> - **The parser call is `candidatesMock.parseResume`** (a write that needs `candidate.create`), so the existing
>   write-authorization and isolation tests cover it. The adapter is `src/lib/api/resume-parse.ts`.
> - **The pure logic is in `model.ts`:** values, `applyDraft`, `validateStep`, `firstOpenStep` and
>   `toCreateCandidate`, which module 05's create calls with the assignment. A3 uses `NEEDS_SPONSOR` from
>   `work-auth-chip.tsx`.
> - **Step 5 is a placeholder.** Until module 05, the pop-up version of `/candidates/new` reloads into the full page
>   when the flag is on.
> - **New classes in `globals.css`, built from tokens:** `.bq-choice`, `.bq-dropzone`, `.bq-focus-target`, and focus
>   rings for compound inputs.

The new "New candidate" flow up to the assign step: the frame (stepper, summary card, footer), the résumé step with the
parser, and steps 2–4. Module 05 adds step 5, the done screen, and swaps the route over. Until then the wizard is
behind a flag, so `main` never ships a half flow.

Read first: [README](./README.md) §2 (Q48–Q49), §4 (the screens), §6 (parser), §7 (assumptions), `design.md`,
`docs/04-SCREENS.md` §0 (rules for every screen) and §1.3 (keyboard map), `docs/05-COMPONENTS.md`,
`src/components/app/candidate/new-candidate-form.tsx` (what it replaces).

## 1. Where it lives

- Behind `NEXT_PUBLIC_CANDIDATE_WIZARD=true`: `src/app/[firm]/(app)/(workspace)/candidates/new/page.tsx` renders the
  wizard instead of `NewCandidateForm`. Read the flag in one place (`src/lib/config.ts` or next to
  `NEXT_PUBLIC_LIVE_MODULES`'s reader). Module 05 removes the flag, the old form and the modal, and moves the page to a
  full-screen layout.
- Components in `src/components/app/candidate-wizard/` (each file under ~200 lines):

| File | What |
|---|---|
| `wizard.tsx` | The frame: header (icon, "New candidate", stepper, ×), main column, summary aside, footer (Back · Skip for now · Continue). |
| `stepper.tsx` | Five steps. Done steps show a check and are buttons (go back to them); later steps are not clickable. |
| `summary-card.tsx` | Initials avatar, name ("New candidate" until set), "Marketed as" ("Role not set"), chips (work auth, engagement types, years), Location, Email, Résumé (file name), **Assigned BDE** (Q48). Below it, the step list with states. |
| `use-wizard.ts` | State with `useReducer`, in memory only (no drafts, Q48): values, which fields were drafted from the résumé, current step, dirty flag. |
| `step-resume.tsx`, `step-basic.tsx`, `step-work-rate.tsx`, `step-preferences.tsx` | One per step (§3). |
| `tag-input.tsx` | Chips with "Press Enter or comma to add", suggestion chips "+ Java", remove with Backspace or ×. Used for skills, target roles, locations, industries, deal breakers. |
| `drafted-marker.tsx` | "Drafted from résumé" marker on a field (§4). |

- The current step is in the URL, `?step=resume|basic|work|preferences|assign`, parsed with Zod (CLAUDE.md: tabs live in
  the URL). With no drafts, a reload starts empty, so on load jump to the first step whose required fields are missing.
- Missing primitives: the repo's `src/components/ui/` has no switch, textarea, radio group or dialog. Add the ones you
  need as shadcn primitives, after checking `docs/01-FRONTEND-ARCHITECTURE.md` §3. Check first whether the support-view
  dialog (`src/components/app/support/`) or `ModalRoute` already gives you a dialog to reuse.

## 2. The frame

- **Continue** validates the step (§3); errors show inline, focus moves to the first invalid field.
- **Back** keeps values. **Skip for now** only on step 4 (all its fields are optional).
- **×** and `Esc`: if anything was entered, a confirm dialog "Discard this candidate? What you entered is lost." (Discard
  / Keep editing); else close straight away. Close goes back (`router.back()`), or to `/candidates` when there's no
  history.
- **Summary card** updates as fields change. Validate `yearsExperience` 0–60 (the screen shows "212 yrs").
- At 390 px the summary aside moves under the stepper as a collapsible "Summary" row; the stepper shows "Step 2 of 5 ·
  Basic details" instead of all five labels.
- Copy rules: `product.md` §4 ("candidate", "rate", "BDE"; work authorization names exactly).

## 3. The steps

### Step 1 — Résumé ([screen](./screens/1-resume.webp))

- Drop zone, or click / `Enter` / `Space` to browse. Accept PDF and Word (`.pdf`, `.doc`, `.docx`) up to 10 MB; reject
  anything else before uploading, with the reason ("PDF or Word only", "Up to 10 MB").
- On a file: the zone shows the file name and "Reading the résumé…" with a skeleton of the next step; then step 2 opens
  with the drafted fields filled and a strip "{n} fields drafted from the résumé — review them before you create the
  candidate."
- Parse error: "Couldn't read this résumé. Try another file, or enter the details yourself." with Try again and Skip.
- "Try a sample" chips: only when the parse adapter runs on mocks (assumption A1).
- "No résumé yet? … Skip, enter manually" → step 2, empty.
- Copy under the heading: "Drop it in and BenchQ fills the profile for you. Everything it pulls out stays editable, and
  **nothing is saved until you create the candidate**." (Q49 — not "sent anywhere".)

### Step 2 — Basic details ([screen](./screens/2-basic-details.webp))

| Field | Required | Maps to |
|---|---|---|
| Full name | yes | `fullName` |
| Marketed as ("The headline title BDEs submit under.") | yes | `primaryRole` |
| Years of experience | no | `yearsExperience` (0–60) |
| Email ("Shown to vendors only when a submission goes out.") | yes | `email` |
| Phone, LinkedIn, City, State | no | `phone`, `linkedinUrl` (a URL), `city`, `state` |
| Skills (tag input; suggestions = parsed skills not yet added) | no | `skills[]` with `source` `RESUME_UPLOAD` or `MANUAL` |
| Summary ("Two or three lines a BDE can paste into an intro email.") | no | `summary` |

### Step 3 — Work authorization and rate ([screen](./screens/3-work-and-rate.webp))

| Field | Required | Maps to |
|---|---|---|
| Work authorization: nine radio cards (H-1B "Transfer needed", H4 EAD, OPT, CPT, Green Card, GC EAD, US Citizen, TN, Other "Explain in notes") | yes | `workAuth` (`H1B`, `H4_EAD`, `OPT`, `CPT`, `GC`, `GC_EAD`, `USC`, `TN`, `OTHER`); `needsSponsorship` / `needsTransfer` derived (A3) |
| Authorization valid until ("BenchQ warns 90 days before it lapses.") | no | `workAuthExpiry` |
| Engagement: C2C, W2, 1099, Full-time (checkboxes, at least one) | yes | `employmentTypes` (`C2C`, `W2`, `TEEN99`, `FTE`) |
| Target rate, walk-away floor (USD per hour; "The floor is never shown to vendors.") | no | `rateTarget`, `rateMin`; floor ≤ target, else "The floor can't be above the target rate." |
| Available from, notice period (days; "0 if they're on the bench now.") | no | `availableFrom`, `noticePeriodDays` |

The radio cards are one radio group: arrow keys move, `Space` selects. If the parser printed a status that didn't
match, show it under the group: "The résumé says: '{workAuthText}'".

### Step 4 — Preferences ([screen](./screens/4-preferences.webp))

| Field | Maps to |
|---|---|
| Target roles (tag input; suggestions: "Marketed as" and the parsed title) — "Jobs are matched against every title here." | `targetRoles` |
| Work setting: Remote, Hybrid, On-site (several) | `workSettings` (provisional) |
| Preferred locations (tag input, "City, state"; suggestions from a constant list of US hubs) | `preferredLocations` (provisional) |
| Willing to relocate (switch) | `willingToRelocate` |
| Preferred industries, deal breakers (tag inputs with suggestions) | `preferredIndustries`, `dealBreakers` (persona) |
| Notes for the BDE ("How they like to be contacted, interview windows, anything personal.") | `contactNotes` (provisional) |

Suggestion lists (locations, industries, deal breakers) are constants in `src/lib/constants/candidate-intake.ts`,
not inline in components.

## 4. Truth Guard on the form (Q49)

- A field filled by the parser carries the **"Drafted from résumé"** marker (icon + label, never colour alone). Editing
  the field removes it; each step has **"Mark as reviewed"**, which removes the step's markers.
- Nothing in the flow says or sets "verified". Skills go into the candidate's Record as `UNVERIFIED` with their
  source; the summary too (`summaryState: UNVERIFIED`). That happens at create (05 on mocks, 06 on the backend).
- The parse result is never written to a component as text: it flows adapter → hook → wizard state.

## 5. Parser to form mapping

Adapter `src/lib/api/resume-parse.ts`: `parse(firmId, file): Promise<ResumeDraft>`, hook `useParseResume()` in
`src/lib/hooks/`. On mocks it returns one of three fixtures in **Zuhair's snake_case format**
(`src/mocks/data/resume-parses.json`, named like the screen's samples) and runs it through the real mapper, so the
mapper is tested before the backend exists. Mapper: `src/lib/api/dto/resume-parse.ts` (`BackendResumeParseSchema` +
`toResumeDraft()`), with tests fed by those fixtures.

| Parser field | Draft field | Rule |
|---|---|---|
| `header.name` | `fullName` | trimmed; empty → null |
| `header.title` | `primaryRole` | as printed |
| `header.email`, `header.phone` | `email`, `phone` | as printed; an invalid email → null |
| `header.linkedin` | `linkedinUrl` | must be a URL, else null |
| `header.location` | `city`, `state` | "Irving, TX" → city "Irving", state "TX" (split on the last comma); one part → city |
| `header.work_authorization` | `workAuth`, `workAuthText` | matched case-insensitively against a table (H1B/H-1B, H4 EAD, OPT, CPT, Green Card/GC/Permanent Resident, GC EAD, US Citizen/USC, TN); no match → `workAuth` null, text kept |
| `work_experience[].start` / `end` / `current` | `yearsExperience` | months covered by all jobs, overlaps merged, an ongoing job ends today, rounded down to whole years; a job with no start is skipped |
| `professional_summary` | `summary` | as printed |
| `technical_skills[]` | `skills[]` | split each group's `skills` on commas, trim, drop empties and duplicates (case-insensitive); `family` = the group's `category` |
| `header.github` | — | not stored yet (no field); listed for Zuhair, 06 §6 |
| `work_experience`, `projects`, `education`, `certifications` | — | not shown in the wizard; the backend builds the Record from them on create (06 §4) |

## 6. Tests

- Mapper: each fixture maps as the table says; location split; work auth table hits and misses; years with overlaps,
  an ongoing job, a missing start; skills split and de-duplicated.
- Wizard reducer: drafted markers set on parse, cleared on edit and on "Mark as reviewed"; dirty flag.
- Steps: required fields block Continue with the right messages; floor > target; 0–60 years; file type and size.
- Discard confirm appears only when dirty.
- `axe` on each step in both themes.

## Done when

- [ ] Steps 1–4 match the screens (with the copy changes above) behind the flag
- [ ] Parser mapping as §5, tested on Zuhair's format
- [ ] No `VERIFIED` anywhere in the flow; drafted markers work
- [ ] Keyboard: every control reachable; `⌘/Ctrl+Enter` = Continue; `Esc` = close (with the confirm); focus moves to
      the step heading on each step change; the drop zone opens with `Enter`/`Space`
- [ ] Skeleton (team and firm loading), parse loading, parse error and page error states present
- [ ] Both themes; 1440 / 1024 / 390 px; `axe` clean; no hardcoded colours, sizes or spacing
- [ ] `pnpm typecheck && pnpm lint && pnpm test` clean

**Do not:** build step 5 or the done screen (05), change the policy or registry (03), call `fetch` outside
`src/lib/api/http.ts`, or call an LLM (the parser is the backend's).
