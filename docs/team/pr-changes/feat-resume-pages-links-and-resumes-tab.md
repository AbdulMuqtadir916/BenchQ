# feat/resume-pages-links-and-resumes-tab — change report

## Scope

Frontend only. No backend change, migration, new dependency, schema or contract change.

1. **Résumé paper: real pages.** The studio preview and Export PDF render the same US Letter sheets. Content is
   measured off-screen and packed so no block is cut by a page break. A job or project may split between bullets,
   with at least 2 bullets on each side and its title/company/tech line kept with the first bullets. The packer
   re-measures once web fonts load and when the template changes. A block taller than a page gets its own sheet and
   runs over it; nothing is clipped. Print CSS: `break-inside: avoid`, `break-after: avoid` on headings,
   `@page { size: letter; margin: 0 }` (each sheet carries the 0.6in `--paper-margin`, so Chrome prints no date/URL
   header).
2. **Links on the paper.** Email → `mailto:`; phone → `tel:` in E.164 (country code from the country field, `+`
   kept); LinkedIn, GitHub and project links → `https://` (also upgraded from `http://`), opened in a new tab, with
   short labels (`linkedin.com/in/<handle>`, `github.com/<owner>/<repo>`, the bare domain). Links are clickable in the
   exported PDF.
3. **Fit to one page** (studio toolbar). Shrinks type and spacing in steps down to fixed floors (body 9.5pt, small
   8pt, line height 1.25, margin 0.45in) and says "Can't fit on one page — trim about N lines" when the floors aren't
   enough. Preview, page count and Export use it. It is held for the open résumé like the template choice and is
   **not saved per résumé**: that needs a stored field (a contract and backend change, open).
4. **Candidate Résumés tab redesign** (plain words, no internal terms). Header row with Upload résumé / Create new
   résumé (Upload moved off the tab bar); one closed card per résumé titled by its role, main résumé first with a
   "Main résumé" badge; "Updated … by … · N versions"; View, Download PDF, "Make main résumé", a ⋯ menu (Edit, Make
   main, Make a copy for a job → Jobs tab, Delete); older versions and job copies behind links; plain-English dialogs;
   empty state. The firm-wide Resume Builder page is unchanged. The résumé editor (Builder/Viewer) UI is unchanged.
5. **Candidate header.** Find jobs / Build resume stay top-right, level with the name, from `md` (768px) up, and stack
   right-aligned below it.

## Files

| Action | File | Purpose |
| --- | --- | --- |
| Modified | `src/app/globals.css` | Paper tokens (`--paper-margin`, fit floors), sheet/print CSS, link style, fit-scaled sizes |
| Added | `src/lib/resume-doc/paginate.ts` (+ test) | Pack measured blocks onto pages, bullet-level splits |
| Added | `src/lib/resume-doc/paper-links.ts` (+ test) | mailto/tel (E.164)/https links and short labels |
| Added | `src/lib/resume-doc/fit.ts` (+ test) | Fit-to-one-page steps and floors |
| Modified | `src/components/app/resume-studio/paper/resume-paper.tsx` | One sheet per page; measuring copy; fit step |
| Added | `src/components/app/resume-studio/paper/use-paper-layout.ts` | Measure, pack, fonts re-measure, fit search, printed page count |
| Added | `src/components/app/resume-studio/paper/measure.ts` | Block and bullet measurement |
| Added | `src/components/app/resume-studio/paper/keep-focus.ts` | Keep the caret when a block moves to another page |
| Added | `src/components/app/resume-studio/paper/paper-entries.tsx` | Jobs/projects with bullet ranges |
| Added | `src/components/app/resume-studio/paper/paper-link.tsx` | The paper's `<a>` |
| Modified | `src/components/app/resume-studio/paper/paper-sections.tsx` | Sections render a page's blocks; heading only with the first |
| Modified | `src/components/app/resume-studio/paper/paper-header.tsx` | Contact links |
| Modified | `src/components/app/resume-studio/editable-text.tsx` | Inert fields in the measuring copy |
| Modified | `src/components/app/resume-studio/preview/preview-pane.tsx` | Fit to one page toggle and message |
| Modified | `src/components/app/resume-studio/preview/template-gallery.tsx` | Thumbnails stay unpaginated |
| Modified | `src/components/app/resume-studio/print-export.tsx` | Export uses the fit setting; optional override for downloads outside the studio |
| Modified | `src/components/app/resume-studio/studio-store.ts` | `fitOnePage`, `fitOverflowLines` |
| Modified | `src/components/app/resume-studio/new-resume.tsx`, `src/app/[firm]/(studio)/resumes/[id]/page.tsx` | `?candidate=` preselects the candidate |
| Modified | `src/components/app/candidate/resumes-tab.tsx` | The redesigned tab |
| Added | `src/components/app/candidate/resumes/*` (+ 2 tests) | Cards, version list, job copies, ⋯ menu, Download PDF, plain-English actions |
| Modified | `src/components/app/resumes/upload-resume.tsx` | Plain-English messages; label prop |
| Modified | `src/app/[firm]/(app)/(workspace)/candidates/[id]/page.tsx` | Upload off the tab bar; "Make a copy for a job" opens Jobs |
| Modified | `src/components/app/candidate/candidate-header.tsx`, `find-jobs.tsx` | Header actions top-right; right-aligned on narrow screens |
| Added | `docs/team/pr-changes/feat-resume-pages-links-and-resumes-tab.md` | This report |

## Checks

- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
- Browser: all six templates, no block past a sheet's margin; a 121-bullet résumé over 4 sheets; caret kept across
  re-pagination; Fit on/off; light and dark; 390px. Export DOM is identical to the preview; Chrome "Save as PDF" of it
  gives the same page breaks, Letter pages and clickable link annotations.
- Résumés tab with 0, 1 and several résumés; BDE-only controls covered by render tests (the local account is an
  Owner of BDE-assigned candidates).
- Header at 768, 1024, 1280, 1440 and 390px: no sideways scroll.

## Remaining limits

- Fit to one page is not saved per résumé (needs a stored field — product/backend decision).
- "Make a copy for a job" opens the Jobs tab; nothing creates a job copy yet ("Tailor & apply" isn't wired).
- "Create new résumé" opens the existing new-résumé screen, which can't save yet.
- No "Upload new version" (an upload always adds a new résumé). No delete on job copies (the backend refuses it).
- axe isn't installed in the repo, so no automated accessibility run.
- Opening one résumé version took ~20s on the local backend (pre-existing; affects the editor too).
