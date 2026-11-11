# PR #128 change report

## Scope

This PR includes the applicable fixes from the BenchQ debug handoff. It targets main after PR #125 and uses the existing BenchQ policy, routes, URL schemas and data stores. There are no new dependencies or migrations. Q47 manager access and the HTTP(S) link policy follow the decisions recorded in the testing handoff. The Ledger scope overlaps with open PR #113.

Current main removed Follow-ups (BUG-009), excludes Saved jobs from the replacement Activity dashboard counts (BUG-008), and shows an empty message on the replacement Job sources card (BUG-020). BUG-006 was verified as a development-only warning and required no production code change. KI-003 remains deferred until the parser has an OpenRouter key. On the candidate Applications tab, Active excludes Saved and Placed (both stay under All), and the count, board and list share that one rule, as the code owner decided in the PR #128 review.

## Files

| Action | File | Purpose |
| --- | --- | --- |
| Modified | `backend/api/routes_candidate_resumes.py` | Validate and normalize links on résumé version saves |
| Modified | `backend/api/routes_candidates.py` | Validate LinkedIn on candidate creation |
| Modified | `backend/api/routes_ledger.py` | Enforce approved Q47 access and support stable cursor pagination |
| Modified | `backend/candidates/first_base.py` | Drop invalid parser links when building the first résumé |
| Added | `backend/candidates/profile_links.py` | Define the shared backend HTTP(S) profile-link policy |
| Modified | `backend/scripts/seed_demo.py` | Keep the candidate object until its first résumé is written |
| Modified | `backend/tests/conftest.py` | Restore the real jobspy module after tests that install fakes |
| Modified | `backend/tests/test_first_base.py` | Cover invalid candidate and parser links |
| Modified | `backend/tests/test_ledger.py` | Verify the approved Manager scope, a concurrent insert between pages, and an offset after a cursor |
| Modified | `backend/tests/test_resume_versions.py` | Cover rejected and normalized links on save |
| Modified | `backend/tests/test_seed_and_admin_cli.py` | Verify seeded candidate identity fields survive first-version creation |
| Modified | `docker-compose.yml` | Give the disposable PostgreSQL instance enough inodes for the full suite |
| Modified | `docs/02-DATA-CONTRACTS.md` | Record the approved profile link validation contract |
| Modified | `docs/integration/01-ledger.md` | Document ledger scope and offset paging |
| Added | `public/resume-highlight.css` | Serve the studio highlight selector as plain CSS |
| Modified | `src/app/[firm]/(app)/(manage)/ledger/page.tsx` | Restore Ledger filters, sort and page from the URL and expose older entries |
| Modified | `src/app/[firm]/(app)/(workspace)/candidates/[id]/page.tsx` | Register and handle Escape on candidate detail |
| Modified | `src/app/[firm]/(app)/(workspace)/candidates/page.tsx` | Preserve dashboard-linked filters and add URL search, sort, pagination and keyboard controls |
| Modified | `src/app/forbidden.tsx` | Show the support banner and Exit action on the 403 screen |
| Modified | `src/app/globals.css` | Move the studio highlight selector out of the global build |
| Modified | `src/components/app/candidate-wizard/model.test.ts` | Regression coverage. Validate and normalize onboarding links and cover bare LinkedIn and unsupported protocols |
| Modified | `src/components/app/candidate-wizard/model.ts` | Validate and normalize onboarding links and cover bare LinkedIn and unsupported protocols |
| Modified | `src/components/app/candidate-wizard/step-basic.tsx` | Normalize the LinkedIn field on blur and let the wizard report invalid links |
| Added | `src/components/app/candidate/assignment-filter.test.ts` | Regression coverage. Cover the extended Candidates URL schema |
| Modified | `src/components/app/candidate/candidate-card-grid.tsx` | Use the shared list search and keep the filtered list URL on card links |
| Modified | `src/components/app/data-table.tsx` | Support URL-controlled sorting and page-wide keyboard navigation |
| Added | `src/components/app/ledger-cap-notice.test.ts` | Regression coverage. Explain when the ledger exceeds the client fetch limit |
| Added | `src/components/app/ledger-cap-notice.tsx` | Explain when the ledger exceeds the client fetch limit |
| Modified | `src/components/app/resume-studio/builder/header-summary.tsx` | Validate and normalize links in the résumé Builder form |
| Modified | `src/components/app/resume-studio/editable-text.tsx` | Allow inline editors to report input validity |
| Modified | `src/components/app/resume-studio/new-resume.tsx` | Pass candidate-based Tailor with AI permission to the studio |
| Modified | `src/components/app/resume-studio/open-resume.tsx` | Pass the existing résumé candidate’s Tailor with AI permission |
| Modified | `src/components/app/resume-studio/paper/paper-header.tsx` | Validate and normalize links while editing the résumé page |
| Modified | `src/components/app/resume-studio/resume-studio.tsx` | Apply Tailor with AI permission and block saving invalid links |
| Modified | `src/components/app/resume-studio/selection-toolbar.tsx` | Load the studio highlight stylesheet where it is used |
| Added | `src/components/app/resume-studio/studio-topbar.test.ts` | Regression coverage. Gate Tailor with AI and disable Save for invalid profile links |
| Modified | `src/components/app/resume-studio/studio-topbar.tsx` | Gate Tailor with AI and disable Save for invalid profile links |
| Modified | `src/components/app/support/support-banner.tsx` | Hide a stale forbidden banner and refresh its server session |
| Added | `src/components/app/support/banner-state.test.ts` | Regression coverage. Decide when the 403 support banner waits, shows, is stale or is absent |
| Added | `src/components/app/support/banner-state.ts` | Decide when the 403 support banner waits, shows, is stale or is absent |
| Modified | `src/components/command/command-palette.tsx` | Use approved action groups, candidate results and recent items |
| Modified | `src/components/command/keyboard-hint-sheet.tsx` | Show shortcuts registered by the current page |
| Added | `src/components/command/palette-results.test.ts` | Regression coverage. Derive palette groups for empty and nonempty searches |
| Added | `src/components/command/palette-results.ts` | Derive palette groups for empty and nonempty searches |
| Modified | `src/lib/api/analytics.ts` | Read Ledger through successive cursor pages up to the disclosed cap |
| Modified | `src/lib/api/dto/candidates.test.ts` | Regression coverage. Keep candidate reads working when LinkedIn data is malformed |
| Modified | `src/lib/api/dto/candidates.ts` | Keep candidate reads working when LinkedIn data is malformed |
| Modified | `src/lib/api/dto/resume-content.ts` | Serialize normalized links when saving résumé content |
| Modified | `src/lib/api/dto/resume-parse.ts` | Normalize parsed profile links using the frontend policy |
| Added | `src/lib/api/live-ledger-all.test.ts` | Regression coverage. Verify Ledger paging at the live API boundary |
| Added | `src/lib/api/paging.test.ts` | Regression coverage. Load cursor pages and report whether the client limit was reached |
| Added | `src/lib/api/paging.ts` | Load cursor pages and report whether the client limit was reached |
| Added | `src/lib/derive/application-counts.test.ts` | Regression coverage. Share rules for submitted and open applications |
| Added | `src/lib/derive/application-counts.ts` | Share rules for submitted and open applications |
| Modified | `src/lib/derive/bde-performance.ts` | Use the submitted-application rule in BDE totals |
| Modified | `src/lib/derive/candidate-stats.ts` | Use shared rules for candidate application totals |
| Added | `src/lib/derive/ledger-actors.test.ts` | Regression coverage. Derive the actor options, including platform admins, and their counts |
| Added | `src/lib/derive/ledger-actors.ts` | Derive the actor options, including platform admins, and their counts |
| Modified | `src/lib/derive/list-filters.ts` | Keep dashboard link parameters separate from numeric table page state |
| Added | `src/lib/derive/new-candidate-block.test.ts` | Regression coverage. Cover the active-manager requirement for opening the wizard |
| Modified | `src/lib/derive/platform.ts` | Share the active-manager check between the button and keyboard shortcut |
| Modified | `src/lib/hooks/use-candidates.ts` | Refresh Ledger after audited candidate changes |
| Added | `src/lib/hooks/use-escape-back.ts` | Go back on Escape when no dialog or editable field handles it |
| Modified | `src/lib/hooks/use-ledger.ts` | Read the whole ledger through cursor pages |
| Modified | `src/components/app/candidate/applications/applications-tab.tsx` | Apply the shared Active rule to the count, board and list |
| Added | `src/lib/hooks/use-page-shortcuts.ts` | Register keyboard help for the current screen |
| Modified | `src/lib/hooks/use-resumes.ts` | Refresh Ledger after audited résumé writes |
| Added | `src/lib/list-keys-dom.ts` | Read focus, modifiers and overlays for keyboard handlers |
| Added | `src/lib/list-keys.test.ts` | Regression coverage. Decide when list navigation or new-item keys apply |
| Added | `src/lib/list-keys.ts` | Decide when list navigation or new-item keys apply |
| Added | `src/lib/list-shortcuts.test.ts` | Regression coverage. Define the keyboard help for lists and candidate detail |
| Added | `src/lib/list-shortcuts.ts` | Define the keyboard help for lists and candidate detail |
| Modified | `src/lib/query/keys.ts` | Give whole-ledger queries a distinct cache key |
| Modified | `src/lib/query/principal-boundary.test.ts` | Regression coverage. Distinguish role changes and replacement support sessions in the cache |
| Modified | `src/lib/query/principal-boundary.ts` | Distinguish role changes and replacement support sessions in the cache |
| Added | `src/lib/resume-doc/profile-link.test.ts` | Regression coverage. Validate and normalize HTTP(S) profile links in the editor |
| Added | `src/lib/resume-doc/profile-link.ts` | Validate and normalize HTTP(S) profile links in the editor |
| Added | `src/lib/routes/ledger-list-query.test.ts` | Regression coverage. Cover Ledger query parsing and defaults |
| Added | `src/lib/routes/ledger-list-query.ts` | Cover Ledger query parsing and defaults |
| Added | `src/lib/routes/page-index.test.ts` | Regression coverage. Clamp URL page numbers to the available table pages |
| Added | `src/lib/routes/page-index.ts` | Clamp URL page numbers to the available table pages |
| Modified | `src/lib/routes/registry.test.ts` | Regression coverage. Offer the Focus mode entry only to principals with route access |
| Modified | `src/lib/routes/registry.ts` | Offer the Focus mode entry only to principals with route access |
| Added | `src/lib/routes/sort-param.test.ts` | Regression coverage. Convert between table sorting and URL parameters |
| Added | `src/lib/routes/sort-param.ts` | Convert between table sorting and URL parameters |
| Modified | `src/lib/schemas/list-search.ts` | Extend the existing Candidates URL schema with query, sort and page |
| Added | `src/lib/search.test.ts` | Regression coverage. Match search terms across the visible fields |
| Added | `src/lib/search.ts` | Match search terms across the visible fields |
| Modified | `src/lib/server/principal.ts` | Reuse server-side session access on the forbidden screen |
| Modified | `src/lib/stores/ui-store.ts` | Store current page shortcuts and recent command palette items |
| Added | `docs/team/pr-changes/fix-bug-014b-resilient-candidate-links.md` | Document scope, files and verification for this PR |

## Checks

Local, 2026-11-11: `pnpm typecheck`, `pnpm lint` and `pnpm test` (774 tests) pass. Backend on PostgreSQL: the first full run passed 4,297 and failed 1 (the route-logging sweep sent an offset with a cursor); that is fixed, and the full suite was rerun: 4,299 passed, 0 failed. See the PR description and GitHub checks for the expanded branch. Full browser verification was performed on the testing branch before porting the fixes to current main.
