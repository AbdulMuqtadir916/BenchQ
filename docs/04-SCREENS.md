# 04 — Screens

**Project:** BenchQ · frontend only
**Version:** 1.1 · 19 October 2026 (aligned with docs/07 v2, Phase L and §14 Admin)

Every route, its layout, its states, its permissions and its keyboard map. If a screen isn't in
here, it doesn't get built — propose it first.

---

## 0. Rules that apply to every screen

**Three states, always.** Skeleton while loading, empty when there's nothing, error when the
adapter throws. In a dev build, make mock calls fail from the browser console —
`window.__BENCHQ_MOCK_FAIL__ = ["candidates.list"]` (or `["*"]` for every call; clear it to recover;
`src/mocks/membership.ts`, inert in production builds) — and walk the app: every error state you hit
must already exist.

**Light first.** Light is the default render; dark is a preference the user opts into. Both are
first-class and both ship complete — but design and review in light, and treat dark as the theme
that must also be correct, not the one that leads. Given the 6:30 PM – 12:30 AM IST shift, expect
dark to get heavy real-world use, so it never becomes an afterthought.

**Density.** This is a production console, not a marketing site. Per design.md v3, default row height
is 36px, compact 32px, comfortable 44px. The setting persists per user in `localStorage`.

**Timezones.** Any timestamp that matters to a US-facing action renders as a `DualTimestamp` —
client-local time primary, IST secondary. Never show a bare UTC string.

**Permission rendering.** A control the current role cannot use is **not rendered at all**. Do not
render a disabled button as a hint that a feature exists. There are two exceptions, where the
disabled state *is* the message:

1. **The export gate:** a resume with unverified claims can't be exported; the button stays visible,
   disabled, naming the count with a jump-to-claim link.
2. **The over-limit block** (docs/07 Q17, Q29): an action the role *may* take but the firm's plan limit
   blocks (add a member at the seat limit, add a candidate at the candidate limit) stays visible,
   disabled, with the reason inline (e.g. "Your plan allows 4 seats; 4 are in use.", §14.11). A role
   that may not take the action at all still sees nothing.

**Counts are derived.** Every number on every screen comes from `src/lib/derive/`. A fixture never
supplies a count.

---

## 1. Global chrome

### 1.1 AppShell

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Topbar  [account menu]    [⌘K search]   [shift clock] [notifications] [theme]│
├────────────┬─────────────────────────────────────────────────────────────────┤
│  Sidebar   │                                                                 │
│  Dashboard │                     route content                               │
│  Candidates│                                                                 │
│  Jobs      │                                                                 │
│  Apps      │                                                                 │
│  Outreach  │                                                                 │
│  Follow-ups│                                                                 │
│  Analytics │                                                                 │
│  Ledger    │                                                                 │
│  ───────   │                                                                 │
│  Settings  │                                                                 │
└────────────┴─────────────────────────────────────────────────────────────────┘
```

There is **no firm switcher** (a user belongs to one firm, docs/07 Q9; the firm comes from the URL) and
**no role switcher** (removed with the dev principal switcher, Q25). The **account menu** (user menu)
shows who is signed in — name, role, firm — and holds **Sign out**. In the admin shell (§14) it
shows the Super Admin, and the topbar has no notifications and no shift clock.

Sidebar: 208px expanded, 60px collapsed, 48px mobile icon rail, state in `localStorage`. Items carry live badge counts
(follow-ups due today, unreviewed unverified claims). Badges are derived, and a badge of zero is
hidden, not rendered as "0".

**Shift clock** in the topbar is not decoration. It shows current US Eastern time alongside IST and
how much of the 6:30 PM – 12:30 AM IST window remains. At 11:45 PM IST it turns amber. The BDE is
working against a clock; the product should acknowledge it.

Sidebar visibility by role:

| Item | OWNER | MANAGER | BDE | VIEWER |
|---|---|---|---|---|
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| Candidates | all | all | assigned only | all, read-only |
| Jobs | ✓ | ✓ | ✓ | ✓ |
| Applications | all | all | own only | all, read-only |
| Outreach | ✓ | ✓ | own only | ✓ read-only |
| Follow-ups | ✓ | ✓ | own only | — |
| Analytics | ✓ | ✓ | — | ✓ read-only |
| Ledger | ✓ | ✓ | own actions | ✓ read-only |
| Settings → Firm | ✓ | — | — | — |
| Settings → Team | ✓ | ✓ | — | — |
| Settings → Templates | ✓ | ✓ | — | — |
| Settings → Preferences | ✓ | ✓ | ✓ | ✓ |

### 1.2 Command palette (`⌘K` / `Ctrl+K`)

One input, grouped results, arrow keys to move, `Enter` to run, `Esc` to close. Groups in order:

1. **Actions** — New candidate, Capture job, New application, Start outreach
2. **Candidates** — fuzzy over name, title, skills
3. **Jobs** — fuzzy over title, company
4. **Navigation** — every route

Recent items show when the input is empty. The palette is the fastest path to everything and it
gets built in Phase 1, not as a nice-to-have at the end.

### 1.3 Global keyboard map

| Key | Action | Scope |
|---|---|---|
| `⌘K` | Command palette | Global |
| `g` then `d` | Go to dashboard | Global |
| `g` then `c` | Go to candidates | Global |
| `g` then `j` | Go to jobs | Global |
| `g` then `a` | Go to applications | Global |
| `g` then `f` | Go to follow-ups | Global |
| `J` / `↓` | Next row | Any list |
| `K` / `↑` | Previous row | Any list |
| `Enter` | Open focused row | Any list |
| `Space` | Toggle row selection | Any list |
| `x` | Select / deselect row | Any list |
| `/` | Focus the list's filter input | Any list |
| `T` | Tailor resume for focused job | Job feed, job detail |
| `A` | Mark applied | Job detail, application detail |
| `O` | Open outreach composer | Job detail, application detail |
| `N` | New (context-dependent) | Any list |
| `Esc` | Close panel / clear selection / go back | Global |
| `?` | Keyboard shortcut sheet | Global |

`?` opens a modal listing every shortcut available in the current context. Build it in Phase 1 and
keep it accurate — it's the cheapest documentation in the product.

---

## 2. Auth and onboarding

### 2.1 `/sign-in`, `/invite/[token]`

`AuthShell`: centred card, product mark, no sidebar. Invite-only, no public sign-up (docs/07 Q11).
Until real auth (Phase D), the form signs in against the **seeded accounts** in the mock layer (docs/03
§3.2: one per fixture user plus the Super Admin, one shared demo password; docs/07 Q25). The session is
shared by every tab (Q27). An unknown email, a wrong password and a deactivated account all get the same
error, "Email or password is incorrect.", so the page never reveals which accounts exist; a service
failure says "Couldn't sign in right now. Try again."

On success: a firm user lands on **`/{slug}/dashboard`** (an OWNER on first run on `/{slug}/welcome`,
§2.2); the Super Admin lands on **`/admin`**. **`returnTo`:** a guard that sends a signed-out visitor
here adds `?returnTo=<path>`. After sign-in it is honoured only if it is a same-origin path **and the
account that just signed in can open it** (`signInTarget`); otherwise — another firm's URL, `/admin` for
a firm user, an external URL — the account's own landing.

Build the states properly anyway: field-level validation, a submit-pending state, a form-level
error banner, and a "check your email" confirmation on the forgot-password request. These are cheap now and expensive
to retrofit.

`/invite/[token]` (07 P4) shows the inviting firm's name and the role being offered, the invite's email
(read-only) and the name the inviter gave (`inviteeName`, prefilled and editable, 07 Q31). The person
sets their name and a password (8+ characters) and accepts: the account is created and signed in (any
other account in this browser is signed out, Q27); an OWNER lands on `/welcome` and makes an
ONBOARDING firm ACTIVE; a staff invite lands on `/admin`. Every other state has its own screen with a
way to sign in: **invalid** (unknown or replaced token — says nothing about any invite), **expired**
("ask the person who invited you to resend it"; resending is the inviter's action), **revoked**,
**already accepted**, and **workspace suspended** (blocked, the invite stays pending, Q28). The link
comes from "Copy link" on a pending invite (admin users tab, owner card, staff invites); a resend issues a
new token and the old link stops working.

### 2.2 `/welcome` — onboarding wizard

Four steps, progress rail on the left, back/next, resumable (step index in `localStorage`).

1. **Firm** — confirms the firm the Super Admin created (§14.4): name, timezones, shift window
   (defaults to 18:30–00:30 IST), each editable here
2. **Invite team** — email rows with role selects; skippable. **Waits for Phase M** (the firm-side
   invite flow, docs/07): until then the wizard skips this step
3. **First candidate** — name, title, work authorisation, resume upload (drop zone simulates a
   parse with a 3s progress state, then shows extracted fields as `UNVERIFIED` claims for review)
4. **Done** — three suggested next actions, routes to dashboard

The resume-parse simulation in step 3 is the first time the user meets the unverified/verified model. Make
it legible: the extracted fields arrive visibly drafted, and confirming one flips it to verified with
the transition described in `design.md`.

---

## 3. `/dashboard`

Role-dependent. Same route, three compositions.

### 3.1 BDE view — "tonight"

The BDE's dashboard answers one question: *what do I do next?*

```
┌─────────────────────────────────────────────────────────────┐
│ Tonight · 4h 12m left in shift          [Start a run ▸]     │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ Applications │ Follow-ups   │ Responses    │ Unverified claims  │
│ 23 / 40      │ 7 due        │ 3 new        │ 5 to review    │
│ ████████░░   │              │              │                │
├──────────────┴──────────────┴──────────────┴────────────────┤
│ My candidates (6)                                            │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Adnan Khan · Sr. Java Dev · H1B   12 apps  2 int  ●●●○○  │ │
│ │ Priya Raman · Data Eng · GC        8 apps  1 int  ●●○○○  │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ Queue — highest-match jobs not yet applied                   │
│ [job row]  [match 87]  [T tailor] [A applied] [O outreach]   │
└──────────────────────────────────────────────────────────────┘
```

The **queue** is the centre of gravity. It's a keyboard-driven list: `J`/`K` to move, `T` to
tailor, `A` to mark applied, `O` to open outreach, `Enter` for detail. A BDE should be able to work
twenty jobs without touching the mouse. Time the interaction yourself — if it takes more than two
keystrokes per job to progress, the design is wrong.

"Start a run" opens focus mode (§9).

**Empty:** no candidates assigned → a single card pointing at the manager. No jobs in queue → an
illustration and a "capture jobs" action.

### 3.2 MANAGER view — "the floor"

Same shell, different content. Team throughput today versus the trailing seven-day average, a
per-BDE strip (applications, responses, interviews, follow-ups overdue), candidates with no
applications in 48 hours flagged in amber, and the pipeline funnel. Every per-BDE row clicks
through to that BDE's filtered application tracker.

This is the transparency feature made concrete. The manager should be able to answer "who is
behind, and on which candidate" in under five seconds of looking at this screen.

### 3.3 OWNER view — "the business"

Manager content plus placements this quarter, time-to-placement trend, cost per placement, and
seat / usage against plan. Read-only rollups; the owner drills into the manager views for detail.
The usage card is **"Seats used x / seatLimit"** with the breakdown "N users + M pending": a seat is an
active user or a pending, unexpired invite (A1). It comes from `deriveFirmUsage` on the firm's users,
invites and candidates, the function `/admin` uses, so the firm number never disagrees with `/admin`'s
(07 M3, asserted in `seats-agree.test.ts`). The invites query is one of the rollups group's reads.

### 3.4 VIEWER view

Manager view with every action stripped. No buttons in the DOM, not disabled buttons.

---

## 4. Candidates

### 4.1 `/candidates` — list

Toolbar: search, filters (status, work auth, employment type, assigned BDE, skills), density
toggle, view toggle (table / cards), `New candidate`.

Table columns: name + avatar, title, work auth chip, status, assigned BDE, applications (30d),
active applications, interviews, last activity, match-ready resume count. Sortable, multi-select
with a bulk bar (reassign, change status, export CSV).

A BDE sees only assigned candidates and the assigned-BDE filter is hidden for them — there's
nothing to filter by.

**Empty:** first-run illustration + `Add your first candidate`. Filtered-to-nothing is a *different*
empty state with a `Clear filters` action — don't reuse the first-run one.

### 4.2 `/candidates/new`

Single-column form, three sections: identity (name, email, phone, location, timezone), professional
(title, years, work auth, employment type, rate expectation, availability), and sourcing (resume
upload, LinkedIn URL, assigned BDE).

The resume drop zone simulates a parse. Extracted fields land as `UNVERIFIED` and the form shows a
review strip: *"14 fields drafted from the resume — review before saving."* Fields the user types
by hand are `VERIFIED` immediately, because the user is the evidence.

### 4.3 `/candidates/[id]` — detail

The page a BDE lives in for one candidate. It answers, in order: *what needs me now*, *where does
every submission stand*, *what did recruiters say*, *where do I submit next*.

**Header.** Initials avatar, name, work-auth chip, candidate status, role · location · years ·
target rate, availability and relocation. The owning BDE shows to managers and owners only — a BDE
looking at their own candidate doesn't need it. Actions: `Find jobs` (runs the matching
sequence inside the Jobs tab — never navigates away) and `Build resume`. Below it, the derived
stat strip (applications, active, interviews, offers, response rate, days on bench); **every stat
is a button** that opens the tab behind it.

**Tabs** — sticky under the top bar, selection slides between tabs, the active tab is kept in the
URL (`?tab=inbox`) so back/forward and shared links work. Arrow keys move between tabs. Counts
show on Applications and Resumes; a dot marks Overview and Inbox when something is new.

| # | Tab | Why it sits here |
|---|---|---|
| 1 | **Overview** | What needs the BDE tonight, then the pipeline and the facts he quotes on calls |
| 2 | **Applications** | Where every submission stands — the working board |
| 3 | **Inbox** | What recruiters said, matched to applications, with suggested status updates |
| 4 | **Jobs** | Where to submit next, ranked for this profile |
| 5 | **Resumes** | What to submit — the master resume is the verified source |
| 6 | **Documents** | What vendors ask for: visa papers, ID, certificates, screening answers |
| 7 | **Activity** | The audit trail a manager opens |

There is no separate Profile/Record tab: it duplicated the master resume and left the BDE unsure
where to fix a claim. The Record stays as the data model behind the master resume.

#### Overview
Left: **Needs your attention** — upcoming recruiter calls and interviews, recruiter emails whose
stage the pipeline hasn't caught up with (one-click *Move to …*), follow-ups due within a day,
"connect the inbox" when it isn't, visa / ID / certificate files expiring within 60 days, and
unverified claims in the master resume (*Review* opens the builder on the first one). Five show, the rest behind
*Show more*; resolving one animates it out. Then **Pipeline** (current count per stage, animated
bars, each row opens the board) and **Latest from recruiters** (four newest emails, or the connect
prompt). Right: **Submission facts** (work authorization + validity, rate and floor, availability
and notice, employment types, relocation, target roles — editable in place, the rate floor can't
exceed the target), **Resume readiness** (verified share of the master resume's claims, with *Review
unverified claims* → `/resumes/[id]?review=1`), **Best new matches**.

#### Applications
Toolbar: *Active / All* and *Board / List*, plus a one-line summary. When emails suggest updates, a
violet strip lists them as one-click chips. **Board** — the shared `ApplicationBoard`: one column
per stage, drag one stage forward (anything else snaps back with the reason), a read-only *Closed*
column under *All*. Cards show role, company, the latest recruiter email as a chip, days in stage
(amber at 3, red at 7) and the next follow-up. **List** — role, company, status, six-dot stage
progress, latest email, applied date. Enter or click opens the **application drawer**: stage
progress with dates, the suggested update, *Move to next stage* / *Mark not selected*, the
**resume sent** (the exact version the client received — master or tailored, template, ATS, with a
warning when the resume has been edited since), every matched email, and a link to
`/applications/[id]`.

#### Inbox
The candidate's Google account, connected by the BDE (candidates apply from their own address).
Not connected → a connect card: what it does, a read-only consent step, then a staged first sync
("Connecting → Reading → Matching to N applications → Found N updates"). Connected → address, last
sync, *Sync now*, *Disconnect*; filter chips with counts (All, Needs update, Interviews,
Shortlisted, Calls, Offers, Not selected); list + reader. The reader shows the proposed call or
interview time (IST, relative), the matched application with its progress, and either *Move to …*
or "pipeline is up to date". Nothing changes on its own — every update is confirmed.

Signals detected per email: `SHORTLISTED`, `CALL_REQUEST`, `INTERVIEW_SCHEDULED`, `ASSESSMENT`,
`OFFER`, `REJECTED`, `CONFIRMATION`. A suggestion is **derived**: it exists only while the
application's stage is behind the stage the email implies.

#### Jobs
The profile-locked job explorer. `Find jobs` plays the matching sequence (read profile → filter by
work authorization → score → rank) with real counts, then the ranked list staggers in.

#### Resumes
The same cards as the Resume Builder library, master first, plus a *New resume* tile. A note explains
that the master resume is the verified source every tailored copy reuses. The export lock shows on
the card itself. Claims are verified in the builder (*Verify with evidence*); a claim cannot be
verified without an attached evidence id.

#### Documents
Left: an upload area (drop or browse; the type is detected from the file name and can be changed;
expiry is asked for visa, ID and certificates), then files grouped by type — work authorization,
identity, resumes, certifications, education, employment letters. Each row: title, file, size,
added, an expiry badge (expired / expires in N days / valid to), "Evidence for N claims" when the
file backs verified claims, *Copy link*, and remove with an inline confirm. An amber banner lists
anything expired or expiring within 60 days. Right (sticky): **Screening answers** — the
candidate's saved answers to standard vendor questions, each with *Copy*, plus *Copy all*.

#### Activity
Status changes and recruiter emails, newest first, grouped by day under sticky day headers, with
actor ("Adnan Khan" / "Automated"). Filter: Everything / Status changes / Emails. Any row opens its
application.

---

## 5. Jobs

### 5.1 `/jobs` — feed

Two panes: filter rail (240px) + virtualised list. Filters: candidate context, match score range,
work-auth fit, client type, remote mode, rate, posted within, source type, hide already-applied.

**Candidate context is the important control.** Selecting a candidate at the top of the rail
re-scores the whole feed against that candidate and enables `T` / `A` / `O` on every row. Without a
candidate selected, the feed is just a list; with one, it's a work queue.

Row: title, company + verification badge, location + remote mode, rate, posted age, source chip,
`MatchScoreBar`, and inline actions. Selecting a row opens a peek panel on the right without
leaving the list — the BDE evaluates most jobs without ever navigating.

Virtualise past 100 rows. 500 rows must scroll at 60fps.

**Empty:** no jobs captured → a card explaining the two capture paths with a link to `/jobs/capture`.
Filtered to nothing → clear-filters state.

### 5.2 `/jobs/capture`

Three tabs.

**Paste** — a textarea that accepts a URL or a raw job description. On submit, a 2–4s parse
simulation, then a review form with every extracted field as `UNVERIFIED`, side by side with the
source text so the BDE can check the parse. Confirm to save.

**Bulk paste** — multiple URLs, one per line. A progress list with per-row status (queued →
parsing → parsed → duplicate → failed). Duplicates surface the existing job with a "view" link
rather than silently dropping.

**Extension** — an install/status panel. Not connected to anything in this repo; renders the
"not installed" and "connected" states from a store flag.

Dedup runs on capture. A duplicate shows a comparison card: what you pasted, what already exists,
and a choice of merge or keep separate.

### 5.3 `/jobs/[id]`

Header: title, company, verification badge, source chip with legal basis, posted and captured
timestamps. Two columns: description with matched requirements highlighted, and a right rail with
the match panel (`ScoringRecord` — requirement-by-requirement HAVE / MISSING / ADJACENT), company
card (H-1B / LCA data, client type, prior applications from this firm), and the action stack
(`Tailor resume`, `Mark applied`, `Start outreach`, `Save`, `Dismiss`).

If the match is `LIGHT` depth, the panel shows a `Run full analysis` action that upgrades it —
matching the JobNavigator cost-control split. The upgrade is an AI simulation per
`03-MOCK-DATA.md §5`: staged progress, 2–5s, output arrives `UNVERIFIED`.

---

## 6. Resume builder — `/resumes` and `/resumes/[id]`

**Library — `/resumes`.** Every resume as a card: file icon (master vs tailored), resume name,
candidate, role, and monospace tags for type, version, ATS score and template. The footer shows
"Ready to export" or the unverified-claim count. Search, a type filter and a candidate filter sit
above the grid. **New resume** and **Upload resume** are the page actions. Clicking a card opens it in
Builder mode; the card's **View** button opens it in Viewer mode.

**The studio — `/resumes/[id]`.** Opens full screen, outside the app shell: no sidebar, no top nav.
A close button (and `Esc`) returns to wherever it was opened from. `?mode=view` opens in Viewer mode;
`/resumes/new` starts a new resume from a candidate's record or blank, and
`/resumes/new?upload=<file>` opens a parsed upload in which every line starts unverified.

```
┌ ✕ │ Master Resume [Master]        [ Builder | Viewer ]      Saved  [Tailor with AI] [Export PDF] ┐
├──────────────────────────────┬─────────────────────────────────────────────────────────────────┤
│ ▸ Header                     │ Template ‹ Classic Serif ▾ ›   − Fit · 91% +   2 pages · Letter  │
│ ▸ Summary        1 to verify │ ┌─────────────────────────────┐                                 │
│ ▾ Experience (4)             │ │  live page, chosen template │                                 │
│    ▸ Sr. Java Dev · Acme …   │ │  page-break guides          │                                 │
│ ▸ Skills (7)                 │ └─────────────────────────────┘                                 │
├──────────────────────────────┴─────────────────────────────────────────────────────────────────┤
│ 🔒 3 unverified claims need evidence before export.  Review next →   7 of 10 verified · 92 words │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Builder mode** — collapsible section forms on the left (Header, Summary, Experience, Skills,
  Education, Certifications, Projects), live page on the right. Rows reorder and remove in place.
  Every claim shows its state chip and a **Verify with evidence** action. Enter in a bullet starts
  the next one.
- **Viewer mode** — the page itself, centered, with a slim outline rail. Click any text to edit it
  where it sits. Selecting text in a claim raises a floating toolbar: bold, italic, underline and
  **Ask AI** (improve wording, make concise, add measurable impact, fix grammar; `⌘J` opens it).
- **Templates** — six styles (Classic Serif, Modern, Minimal, Executive, Compact, Two Column). The
  ‹ › arrows (or `[` `]`) step through them; the name opens a strip of live thumbnails rendered from
  this resume's own content. The page is always white in both themes — it is the printed document.
- **AI output always lands unverified** — a rewrite from the selection toolbar or a **Tailor with
  AI** run marks the affected claims unverified and flashes them.
- **Export PDF** prints a clean copy of the page through the browser's print dialog.

**The export gate.** The export button is disabled whenever any claim in the resume is `UNVERIFIED`.
The disabled state carries the reason: *"3 claims need review before export"* with a link that
focuses the first one. This is the one place a disabled control is correct — the block is the
product's point, and hiding it would teach the wrong model.

`CONTRADICTED` claims are excluded from the page and the export entirely, and shown in Builder mode
with a line-through.

---

## 7. Applications — `/applications`

Three views over one dataset, toggled in the toolbar, selection preserved across the switch.

### 7.1 Kanban
Columns per `ApplicationStatus`. Cards: candidate, job, company, days in stage, next follow-up,
owning BDE. Drag between columns transitions status optimistically and writes a ledger event; an
invalid transition snaps back with a toast naming why. Column headers carry derived counts and
column WIP is visible at a glance.

### 7.2 Table
TanStack Table, virtualised, grouping by candidate / BDE / company / status, column visibility and
order persisted, CSV export of the current view. This is the manager's view.

### 7.3 Calendar
Month and week. Applications on their submitted date, interviews on their scheduled date,
follow-ups on their due date. Click any item for the peek panel. Useful for spotting the days
nobody worked.

### 7.4 `/applications/[id]`
Header with candidate → job → company and the current status. Body: the status timeline with dual
timestamps and actor, the resume version used (with a link to the exact version, not the latest),
the outreach thread, follow-ups, screening answers pulled from the Q&A bank, and notes.

Status changes happen here or on the kanban; both write the same ledger event.

---

## 8. Outreach, follow-ups, analytics, ledger

### 8.1 `/outreach`
Left: contact list per application, with verification state. Right: composer with template
selection, merge-field preview, and a claim check that refuses to send if the message body contains
a unverified claim pulled from the record. Sent items show channel, timestamp, and result.

There is no sending in this repo. "Send" logs the outreach locally and advances the mock thread.

### 8.2 `/followups`
Grouped: overdue (red), today, this week, later. Row: candidate, job, kind, due, owner. Actions:
done, snooze (1d / 3d / 1w / custom), cancel, open application. Bulk complete from the selection
bar. Overdue count feeds the sidebar badge.

The default rhythm is day-3 LinkedIn, day-7 email — generated when an application moves to
`APPLIED` and visible here immediately.

### 8.3 `/analytics` — MANAGER+
Date range and comparison period across the top. Sections: funnel (applied → response → screening →
interview → offer → placed, with conversion between each), throughput over time by BDE, per-BDE
table with submissions / response rate / interviews / placements, per-candidate performance,
company response rates, and source effectiveness.

Every chart is Recharts, every chart has a table equivalent behind a toggle, and every chart has an
empty state for ranges with no data. Charts must be readable in both themes — check the axis and
grid colours, not just the series.

### 8.4 `/ledger`
Append-only, immutable, virtualised. Filters: actor, entity type, action, date range. Row: dual
timestamp, actor, action, entity, and a diff expander showing before and after. No edit, no delete,
no exceptions — the ledger is the thing the manager trusts.

---

## 9. Focus mode

Triggered by "Start a run" on the BDE dashboard. Full-screen, chrome hidden, one job at a time
against the selected candidate:

```
┌──────────────────────────────────────────────────────────────┐
│ Adnan Khan · job 7 of 24 · 18 min elapsed        [Esc exit]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Sr. Java Developer · Acme Corp · Remote · $75/hr C2C       │
│   Match 87 — 9 of 11 requirements                            │
│   [requirement chips]                                        │
│                                                              │
│   [T] Tailor    [A] Applied    [O] Outreach    [S] Skip      │
└──────────────────────────────────────────────────────────────┘
```

Single keystroke per decision, auto-advance, progress across the top. `Esc` exits and returns to
the dashboard with a session summary: jobs reviewed, applications logged, time spent.

This screen is the time-compression feature in its purest form. If it works, the product works.
Build it in Phase 5, after the pieces it composes are solid — but design everything before it with
the knowledge that it exists.

---

## 10. Settings

| Route | Role | Content |
|---|---|---|
| `/settings` | all | No content: redirects to the first section the role may open (docs/07 Q1) |
| `/settings/firm` | OWNER | Firm name, logo, timezone, shift window, default follow-up cadence |
| `/settings/team` | OWNER, MANAGER | Member table and candidate assignment matrix. **OWNER** invites, removes and deactivates members and changes roles; **MANAGER** sees the team read-only and assigns candidates to BDEs (docs/07 Q15). BDE and VIEWER don't see it |
| `/settings/templates` | OWNER, MANAGER | Resume templates and outreach templates, with preview and merge-field reference |
| `/settings/preferences` | all | Theme, density, keyboard shortcut sheet, notification preferences, timezone display |

`/admin/…` is the platform tier, `PLATFORM_ADMIN` only (not-found for everyone else): see **§14**.
It never appears in the sidebar for any other role.

---

## 11. Responsive

| Width | Behaviour |
|---|---|
| ≥ 1440px | Full layout, all panes, peek panels |
| 1024–1439px | Sidebar auto-collapses, three-pane becomes two with a preview toggle |
| 768–1023px | Sidebar becomes a drawer, tables scroll horizontally with a pinned first column |
| < 768px | Read-mostly: dashboard, candidate detail, application detail, follow-ups. Kanban becomes a status-filtered list. The resume builder stacks: Builder mode shows the section forms full width; Viewer mode fits the page to the screen. |

Mobile is for checking, not for working. Be honest about that in the UI rather than shipping a
cramped builder nobody can use.

---

## 12. Error and edge states to build explicitly

- Adapter 500 → error card with retry, never a blank screen
- Adapter 404 on a detail route → not-found state with a back link
- Role-forbidden route → a clear "you don't have access" screen, not a redirect loop
- Offline → a topbar banner, queued actions held in the store
- Slow AI simulation → staged progress with a cancel action after 8 seconds
- Empty after filtering → distinct from empty because nothing exists
- Optimistic update rejected → revert with a toast naming the reason
- Resume export blocked → gate message with a jump-to-claim link
- Duplicate job on capture → comparison card, merge or keep
- Principal changes mid-flight (sign-out, another account signed in, another tab) → the query cache is
  cleared and the app remounts, so no data from the previous account stays on screen

---

## 13. Multi-card pages — loading and error (decided 2026-10-18)

Pages made of several cards fed by several queries (the four dashboards today; the `/admin`
overview in Phase P) follow one pattern. Code: `src/lib/query/query-group.ts` (`queryGroup`,
`hasPageFailed`) and `src/components/app/card-group.tsx` (`GroupBody`, `GroupRowError`). Test:
`src/features/dashboard/dashboard-errors.test.ts`.

1. **A card group is the unit.** A group is the smallest set of cards that read the same queries: a
   row of stat cards fed by the same data is one group; a table, a chart and a list each are their
   own. Each group declares its queries: `const throughput = queryGroup(candidatesQuery, …)`.
2. **Loading:** the group shows its skeleton while any of its queries is loading.
3. **Error, per group:** if any query the group reads has failed, the group shows an inline error
   with **Retry** in place of its content (a stat row shows one error card spanning the row). Retry
   refetches only the failed queries. An error wins over loading, so a failed query is never drawn
   as data while a sibling query is still in flight.
4. **Never a number from failed data.** A group renders only when every query it reads succeeded:
   no zeros, no "Nothing due", no empty list standing in for "didn't load". Titles that carry a
   count (`My candidates (8)`) drop the count unless the group loaded. Content is passed to
   `GroupBody` as a function so it isn't even built from missing data.
5. **Everything failed → one page-level error.** When every query the page reads has failed, the
   page shows its header and a single page-level error with Retry (refetching everything), not one
   identical error per card.
6. **Partial failure stays partial.** Groups whose queries loaded keep rendering their real data
   next to the failed ones; a Retry that fixes a shared query recovers every group that reads it.

Groups on today's dashboards: OWNER — rollups (applications, candidates, team) + the floor groups;
MANAGER / VIEWER — throughput (candidates, applications, team), per-BDE performance (+ follow-ups),
pipeline funnel (applications), at-risk (candidates, applications); BDE — tonight's numbers
(candidates, applications, follow-ups), my candidates (candidates, applications), queue
(candidates, applications, jobs).

---

## 14. Admin (platform tier) (decided 2026-10-19)

Built from `docs/07` §2.3, §2.5, §4 and decisions Q17–Q24 (seat/limit rules A1–A4, slug rules A7,
invites A9–A11, support view A12, ledger A13–A14); the open points were decided in 07 Q29. Phases:
the screens and their writes are P3; the support view (14.10) is P4; ⌘K for admins is P5.

Applies to every screen below, in addition to §0:

- **Who:** `PLATFORM_ADMIN` only. Everyone else gets the plain not-found (07 §2.3). No Forbidden screens here.
- **Shell:** the admin shell from P2 (frosted shell, admin nav, no firm notifications, no shift clock —
  the BDE's shift isn't the admin's).
- **Numbers:** every count, total and flag is derived (`deriveFirmUsage` and friends). Never a literal.
- **States:** every data surface has skeleton, empty and error; `[firmId]` routes also have not-found.
  Multi-card pages use the §13 per-group pattern.
- **Permission rendering (§0):** an action that doesn't apply to a row or a state is not rendered
  (Reactivate on an active firm, Deactivate on the OWNER). The exception is the over-limit block, §0's
  second exception: visible, disabled, with the reason inline (14.11).
- **Timestamps:** admin actions aren't US-facing, so `DualTimestamp` isn't required: IST, with relative
  time ("3 h ago") and the full date on hover. Times shown *about a firm's work* (last activity) follow
  the same rule.
- **Writes:** in the mock layer (UI-first). Every write appends the matching ledger entry (A13). Every
  destructive or hard-to-reverse action goes through a confirm dialog.
- **Lists:** filters, sort, search and page live in the URL, parsed with Zod. `J`/`K` move, `Enter` opens,
  `/` focuses the filter (§1.3). Row density per §0.
- **Widths:** per §11. The admin area is desk work: full layout at ≥ 1440, two-pane at 1024; below 768,
  read-mostly — lists and firm detail are readable, create/edit forms still work, but nothing is designed
  for heavy use on a phone.

## 14.1 Admin nav and keyboard

Nav order: Overview · Firms · Plans · Audit · System · Team.

| Key | Action |
|---|---|
| `g o` | Overview|
| `g f` | Firms|
| `g p` | Plans|
| `g a` | Audit|
| `g s` | System|
| `g t` | Team|
| `n` | New firm (on Firms)|
| `⌘K` | Firm search by name or slug; "View workspace of {firm}"; admin nav. No firm-scoped commands outside a support view (P5) |

`g f` and `g a` mean Follow-ups and Applications in the firm area (§1.3). Inside a support view the admin
is in the firm's UI, so the firm map applies there; the admin map applies only under `/admin`. The `?`
sheet always shows the map for where you are.

## 14.2 `/admin` — Overview

**Purpose:** what needs the Super Admin's attention right now, then the health of the business.

**Layout (top to bottom):**

1. **Needs attention** (one card, list). Each row links to the firm:
   - firms **over a limit** (`isOverLimit`), with which limit and by how much;
   - **onboarding firms whose owner invite has expired** (the firm can't go ACTIVE until it's resent);
   - **onboarding firms older than 7 days** with the owner invite still pending;
   - support views **currently open** by any admin.
   Empty: "Nothing needs attention."
2. **Firms by status** (stat group): Active · Onboarding · Suspended, each a link to the firms list filtered.
3. **Seats** (stat group): seats used vs. seat limits summed over ACTIVE firms; active users (all firms).
4. **AI spend:** not shown until its `AiUsage` contract is approved (14.9).
5. **Recent platform activity:** last 10 entries from `/admin/audit`, "View all" link.

**States:** §13 per group. A firm count of zero is a real zero only once the firms query has loaded.

## 14.3 `/admin/firms` — Firms list

**Columns:** name · slug (monospace) · status badge · plan · seats used / limit · over-limit flag ·
owner (name, or "Invite pending" / "Invite expired") · created · last activity.

**Controls (in the URL):** search (`q`, name or slug) · status (`all | ACTIVE | ONBOARDING | SUSPENDED`) ·
over limit only (`overLimit=1`) · sort (`name | created | lastActivity`, default `lastActivity` desc) · page.

**Actions:** "New firm" (primary, `n`). Row → `/admin/firms/[firmId]`.

**Empty:** with no firms at all, "No firms yet" plus "Create the first firm". With filters, "No firms match"
plus "Clear filters".

**Last activity** = latest ledger entry with that `firmId`. Derived.

## 14.4 `/admin/firms/new` — Create firm

**Fields:**

| Field | Rules |
|---|---|
| Firm name | required |
| Slug | required. Suggested from the name as you type (until edited). Live check as you type: pattern and length (A7), reserved word (07 §2.4), taken. Each failure has its own message. Shows the resulting URL: `benchq…/{slug}/dashboard` |
| Plan | required, active plans only. Shows the limits that will be copied onto the firm (A3) |
| Primary timezone | default `Asia/Kolkata` |
| Client timezone | default `America/New_York` |
| Contact phone | optional |
| Owner name | required |
| Owner email | required, valid email |

Not on this form: Truth Guard mode and application expiry days. They take their defaults; the firm's OWNER
changes them in `settings/firm`.

**Submit:** creates the firm (`ONBOARDING`), copies the plan's limits, creates the OWNER invite (7 days,
sent by this admin), writes `FIRM_CREATED` and `INVITE_SENT`, then goes to `/admin/firms/[firmId]` with a
toast "Firm created. Invite sent to {email}."

**Cancel / `Esc`:** back to the firms list. If fields were edited, confirm discard.

## 14.5 `/admin/firms/[firmId]` and its tabs

**Header (all tabs):** firm name, slug, status badge, over-limit badge when set. Tabs as sub-routes:
Overview · Users · Plan · Activity.

**Header actions:**

| Action | Behaviour |
|---|---|
| View workspace | Opens the support-view dialog (14.10, P4). Shown for an ONBOARDING firm with no users too: the workspace just shows its empty states |
| Edit | Dialog: name, contact phone, timezones. Writes `UPDATE` |
| Change slug | Separate dialog. Same live checks as create. Warns: "Every link to this firm's workspace will stop working. There is no redirect." Requires typing the new slug to confirm. Writes `UPDATE` with old → new in the summary |
| Suspend | Confirm dialog with a required reason (min. 10 chars). Explains: firm users can sign in but see "Workspace suspended"; nothing is deleted. Writes `FIRM_SUSPENDED` (reason in summary) |
| Reactivate | Confirm dialog. Not blocked by being over a limit. Writes `FIRM_REACTIVATED` |

Suspend shows only for ACTIVE firms; Reactivate only for SUSPENDED.

**Not-found:** unknown `firmId` → not-found inside the admin shell.

### Overview tab

- **Profile:** name, slug, timezones, contact phone, created.
- **Plan and usage** (group): plan name; **Seats used** `N / limit` with breakdown "X active users + Y
  pending invites"; **Active candidates** `N / limit` ("ON_BENCH, INTERVIEWING, OFFER"). Over a limit: the
  number in the danger colour with label, plus "New additions are blocked. Existing users keep working."
- **Owner:** name and email, status (Active / Invite pending, expires {date} / Invite expired). If the
  invite is pending or expired: "Resend invite".
- **Recent activity:** last 5 of this firm's ledger entries, "View all" → Activity tab.

### Users tab — `/admin/firms/[firmId]/users`

- **Members table:** name · email · role · status (Active / Deactivated) · last active.
  Row action: **Deactivate** (confirm; logs `STATE_CHANGE`, 07 Q30). Reactivate (confirm; **blocked when the firm can't add a seat**, A4,
  rendered as §0's over-limit exception: visible, disabled, the reason inline, e.g. "Your plan allows 4
  seats; 4 are in use.").
  The OWNER cannot be deactivated (ownership transfer is out of scope, A10); on the OWNER's
  row the action is not rendered (§0) and the role cell reads "Owner".
- **Pending invites table:** email · role · sent by · sent · expires · status.
  Actions: **Resend** (new token, +7 days, logs `INVITE_SENT` "Invite resent to …", Q24) and **Revoke**
  (confirm; logs `INVITE_REVOKED`). Expired invites show "Expired" and offer Resend only.
- No "invite member" here: firms invite their own members (Phase M). The admin only sends the OWNER invite
  at creation.

Empty: members "No users yet — the owner hasn't accepted their invite."; invites "No pending invites."

### Plan tab — `/admin/firms/[firmId]/plan`

- **Current:** plan name and the firm's effective limits.
- **Change plan:** select a plan → preview shows the new limits and, if current usage exceeds them, a warning:
  "This firm will be over its seat limit (7 / 4). Existing users keep working; new additions will be blocked."
  Allowed (A4: never auto-remove). Confirm writes `PLAN_CHANGED` with before → after in the summary (A14).
- **Custom limits:** "Adjust limits" sets limits different from the plan's (e.g. Starter with 6 seats; the
  Firm holds the effective limits, A3). Same over-limit preview as a plan change. Logged as `PLAN_CHANGED`
  with before → after; the firm is marked "custom limits" on this tab, the firm header and the firms list.
  The mark is derived (07 Q30): the firm's latest `PLAN_CHANGED` is a limits adjustment (`entityType:
  "firm_limits"`); a plan change (`entityType: "firm"`) clears it.
- **History:** derived from this firm's `PLAN_CHANGED` entries: date, by whom, before → after.

### Activity tab — `/admin/firms/[firmId]/activity`

This firm's ledger, newest first, every action including support views (`ADMIN_ACCESS` /
`ADMIN_ACCESS_END`, with admin name and reason). Filters in the URL: action type, actor type, date range.
Read-only.

## 14.6 `/admin/plans` — Plan catalogue

**Table:** name · seat limit · candidate limit · features (labels) · status (Active / Hidden) · firms on
this plan (derived count).

**Actions:** New plan · Edit · Hide (isActive false) / Show.

The edit dialog states plainly: "Changes apply to firms assigned this plan from now on. Existing firms keep
their current limits." (A3)

Writes `CREATE` / `UPDATE` with `entityType: "plan"` (lowercase, like every ledger entity type), `firmId` null.

No prices, no billing fields.

## 14.7 `/admin/audit` — Platform audit log

Every ledger entry, platform and firm (A13). Columns: when · actor (name, type) · action · firm (link, or
"Platform") · entity · summary.

Filters in the URL: firm, action, actor type, platform-only (`firmId` null), date range. Default: last 7
days.

Empty: "No activity in this period."

## 14.8 `/admin/team` — BenchQ staff

- **Staff table:** name · email · status · last active. Action: Deactivate (confirm).
  You can't deactivate yourself, and the last active admin can't be deactivated.
- **Invite staff:** email only (role is always `PLATFORM_ADMIN`, A11). Pending staff invites with Resend /
  Revoke, as on the firm users tab.

Never empty (you are on it).

## 14.9 `/admin/system` — placeholder until its contracts are approved

07 §2.3 lists backend health, scraper runs and AI spend by firm and model. **None of these have a data
contract**, and CLAUDE.md requires one (with sign-off) before any schema or fixture. Agent and tailoring
runs carry `firmId` (A17), but no approved field records cost or tokens.

P3 builds `/admin/system` as a placeholder page ("Being specified") holding the **Reset demo data** card
(docs/03 §3.3, moved from the `/admin` placeholder); AI spend stays hidden on the overview. Three contracts
are drafted for sign-off separately — `HealthCheck`, `ScraperRun`, `AiUsage` (firmId, model, tokens in/out,
cost, run reference, timestamp) — and the page is built after approval. The contracts are now
approved, not built (`docs/02` §3.2, 07 Q33, Q34).

## 14.10 Support view

**Start from the firm page:** "View workspace" opens a dialog: firm name, a required reason (min. 10
chars, live counter), and the notice "The firm will see your name and this reason in its activity log."
Start → creates the view (60 minutes), writes `ADMIN_ACCESS`, goes to `/{slug}/dashboard`.

**Start from a firm URL (interstitial, 07 §2.5 row 4):** same content as a full page in place of the firm
screen, with "Back to {firm} in admin". Replaces P2's "Support view required" screen.

**Banner (every firm page while active, not dismissible; fixed to the bottom of the screen so it never covers the page header):** "Support view of {firm} · read-only · started
{time} by {admin} · {mm} min left · Exit". At 5 minutes left the remaining time switches to the warning
colour.

**Exit / expiry / sign-out:** ends the view, writes `ADMIN_ACCESS_END`, returns to `/admin/firms/[firmId]`.
On expiry, a notice there: "Your support view of {firm} ended after 60 minutes." To continue, start a new
view (A12).

**One at a time:** starting a view of firm B while viewing firm A ends A first (both entries logged).

## 14.11 Decisions (07 Q29, 2026-10-19)

1. **System and AI spend:** `/admin/system` is a placeholder; `HealthCheck`, `ScraperRun` and `AiUsage`
   contracts are drafted for sign-off separately; the demo-data reset moves onto the placeholder; AI spend is
   hidden on the overview until its contract is approved (14.9).
2. **Custom limits** per firm: allowed, logged as `PLAN_CHANGED`, the firm marked "custom limits" (14.5).
3. **View workspace** of an ONBOARDING firm with no users: allowed; it shows empty states.
4. **Suspend:** ACTIVE firms only.
5. **Stalled onboarding** shows in Needs attention after 7 days.
7. **Over-limit block:** the second §0 exception. The action (Reactivate user here; Invite and New candidate
   on firm pages in Phase M) stays visible but disabled, with the reason inline: "Your plan allows 4 seats; 4
   are in use." Like the export gate, the block is the message.
8. **Defaults accepted:** the OWNER can't be deactivated; you can't deactivate yourself or the last active
   admin; a slug change needs the new slug typed to confirm; the `g`-shortcuts in 14.1; the 5-minute warning
   on the support banner.
