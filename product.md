# product.md — What BenchQ Is and Who It's For

**Project:** BenchQ · frontend only
**Version:** 1.0 · September 2026

`CLAUDE.md` says how to work. `design.md` says how it looks. The `docs/` set says what to build.
**This file says why**, so that when a screen spec doesn't cover a case, the judgment call lands in
the right place.

Read this once at the start of a session. When you're unsure whether something should be a modal
or a page, whether a number needs a tooltip, or whether an action deserves a confirm — come back
here and ask what the BDE at 11pm would want.

---

## 1. The user

**Adnan Khan is a bench-sales recruiter** — a BDE, business development executive — at a small
US-focused IT staffing firm in Hyderabad. He works **6:30 PM to 12:30 AM IST** so his hours overlap
the US business day. He is the primary user of this product and almost every design decision should
be made for him.

He manages **5 to 10 candidates** who are "on the bench" — consultants employed by the firm but not
currently placed with a client. Every day they're unplaced costs the firm money. Adnan's job is to
get them submitted to as many appropriate open roles as possible, as fast as possible.

His target is **20 to 30 submissions per candidate per day.** Today he does all of it by hand.

### What his night actually looks like

| Step | Today, by hand |
|---|---|
| 1 | Open Dice, LinkedIn, job boards, vendor email lists in a dozen tabs |
| 2 | Read job posts, guess which suit which candidate |
| 3 | Copy the job into a spreadsheet |
| 4 | Check whether someone at the firm already submitted this candidate here |
| 5 | Open the candidate's resume in Word |
| 6 | Manually reword the summary and skills to match the job |
| 7 | Export to PDF, rename the file |
| 8 | Write an email to the vendor or recruiter from memory |
| 9 | Fill a submission form, retyping the same screening answers again |
| 10 | Log it in a spreadsheet — or forget to |
| 11 | Set a mental reminder to follow up in three days — and forget that too |

Steps 3 through 10 repeat 20 to 30 times per candidate. By application forty he is tired, and the
quality of steps 6 and 8 collapses. **The tiredness is the design problem.** A product that is
merely usable when you're fresh has failed.

### What this means for the UI

- Every extra click is a real, measurable cost. Not a nitpick.
- Keyboard beats mouse. Focus mode exists because one keystroke per decision is the target.
- Nothing should require remembering something from a different screen.
- The interface must stay legible and forgiving at hour five, not hour one.
- Never make him retype something the product already knows.

---

## 2. The two core features

Everything in this product serves one of these. If a feature serves neither, it needs a reason to
exist.

### 2.1 Time compression — *the primary feature*

Cut the manual work in the eleven steps above. Not by automating away his judgment — by removing
every step that is mechanical.

The product's honest promise is: **the same night's work, in half the time, at higher quality.**

Where the UI carries this:

- The **job feed with candidate context** replaces steps 1–4
- The **resume builder** replaces steps 5–7
- The **outreach composer with templates and the Q&A bank** replaces steps 8–9
- **Automatic logging and follow-up generation** replaces steps 10–11
- **Focus mode** compresses the whole loop into one keystroke per decision

### 2.2 Total transparency — *the feature that sells it*

The BDE gets time back. **The owner and the manager get to see the floor.**

Today an owner running five BDEs has no reliable idea who submitted what, for which candidate, to
which client, or whether anyone followed up. It lives in spreadsheets and memory. When a candidate
sits unplaced for six weeks nobody can reconstruct why.

BenchQ answers, at any moment: how many BDEs are working, on how many candidates, with how many
applications, at what stage, with what response rate, and what has gone quiet.

Where the UI carries this:

- The **manager dashboard** should surface a behind-schedule BDE within five seconds of looking
- The **application tracker** is the shared source of truth, not a report generated after the fact
- The **ledger** is append-only and immutable, which is what makes it trustworthy
- **Every number is clickable** and leads to the rows behind it — a statistic you can't drill into
  is a statistic nobody believes

These two features are also the commercial split: time compression is why the BDE tolerates a new
tool; transparency is why the owner pays for it. Both must be visibly true in a demo.

---

## 3. AI drafts, a human decides

AI assistance is only safe in this industry if a person stays in charge: fabricated resumes are a known,
endemic problem. BenchQ's position is that **AI drafts and the BDE decides** what goes out.

(Until 2026-11-05 the product also carried a Verified / Unverified / Contradicted state on every claim, an
evidence record behind it, and an export gate. That was dropped: there are no claim states, no evidence
tables and no export block. Any résumé that has not been deleted can be exported.)

What stays:

- **AI never invents facts.** The parser's and the tailoring prompts forbid content that is not in the candidate's
  own résumé, and the parser's strict response format enforces it. This lives in the backend, not in a state.
- **A person sends.** BenchQ does not auto-apply. The BDE reads the résumé over and decides every submission.
- **A sent résumé is frozen.** An application points at the exact version that went out; later edits make a new
  version and never change it.
- **The résumé the client received stays visible**, even after it is deleted, on the application it was sent with.

### Why this matters commercially

Staffing firms get burned by inflated resumes. A candidate who can't answer for what's on their own resume
damages the firm's relationship with the client permanently. The product keeps the human's read-over a
one-second step, not homework.

---

## 4. Vocabulary

Use these terms in UI copy. Getting them wrong makes the product read as built by outsiders, which
in this market is fatal.

| Term | Meaning |
|---|---|
| **Bench** | Consultants employed by the firm but not currently on a client project |
| **BDE** | Business development executive — the bench-sales recruiter. The primary user. |
| **Submission** | Sending a candidate to a role. What the BDE's day is counted in. |
| **C2C** | Corp-to-Corp — the firm contracts with the vendor company to company |
| **W2** | The consultant is a direct employee for that engagement |
| **1099** | Independent contractor arrangement |
| **Prime vendor** | Holds the contract directly with the end client |
| **Implementation partner** | Large systems integrator between the client and the vendor chain |
| **Direct client** | The end company that actually needs the work done. The shortest chain and the best outcome. |
| **Hotlist** | The list of available bench consultants a firm circulates to its vendor network |
| **Rate** | Hourly, usually quoted C2C. The central commercial number. |
| **H-1B / H4-EAD / OPT / CPT / GC / GC-EAD / USC / TN** | Work authorisation statuses. Filtering by these is not optional — it's the first thing checked. |
| **LCA** | Labor Condition Application. Public filings that show which companies actually sponsor, at what wage. |
| **Screening questions** | The repetitive questionnaire on most submission forms. Why the Q&A bank exists. |
| **Manager** | The MANAGER a BDE reports to, and the MANAGER responsible for a candidate. Every BDE and every candidate has exactly one (07 Q40–Q41). |
| **Assigned BDE** | The one BDE who markets a candidate. Never call this the candidate's "owner" — OWNER is the firm's owner. |
| **Needs a BDE** | A candidate handed to a manager who hasn't picked a BDE yet. Doesn't count toward the candidate limit. |
| **Working statuses** | On bench, interviewing, offer: the statuses that count toward the plan's candidate limit and a BDE's load (07 Q45). |
| **Load** | A BDE's candidates in a working status. There is no per-BDE cap: the plan's BDE seats and candidate limit are the only limits (07 Q63). |
| **Seat** | One BDE, or one pending BDE invite. Owners, managers and viewers don't take seats (07 Q44). |
| **Handoff note** | The note written when a candidate is assigned. Context that isn't on the résumé. |

**Copy rules:** say "submission" not "job application" where the audience is the firm. Say
"candidate" not "user" — the user is the BDE. Say "rate" not "salary". Never abbreviate work
authorisation statuses into something invented.

---

## 5. The roles, and what each one cares about

| Role | Wants to know | Should feel |
|---|---|---|
| **BDE** | What do I do next? | Fast. Never blocked. Never retyping. |
| **MANAGER** | Who is behind, and on which candidate? | In control without micromanaging. |
| **OWNER** | Are we placing people, and what does it cost? | Confident in the numbers. |
| **VIEWER** | What's the current state? | Informed, with nothing they can break. |

Same routes, different compositions. A control a role can't use is **not rendered** — not disabled.
A disabled button advertises a feature the user can't have, which is worse than silence.

A BDE sees only their assigned candidates and their own applications; a MANAGER sees their team — the candidates
they manage and their BDEs' work (docs/07 Q47); a BDE doesn't add candidates, the OWNER and MANAGERs do (Q41). This isn't a security
boundary in this repo (there's no backend) but the UI must behave as though it is, because verifying
it now is how it stays correct when the backend lands.

---

## 6. Constraints that shape the UI

These come from legal and commercial reality, not preference. They show up on screen and you
shouldn't design them away.

**Job sourcing is bring-your-own-session.** BenchQ's servers never scrape Dice or LinkedIn — their
terms prohibit automated retrieval, and Dice's specifically prohibits using their data to train or
improve AI models. Capture happens through paste, bulk paste, or an extension running in the BDE's
own authenticated browser session.

**This is why every job carries visible provenance.** `SourceChip` shows source type and legal
basis on the row, not buried in a menu. It's a compliance feature and it stays visible.

**Assisted, not automated.** BenchQ does not auto-apply. A human decides every submission. This is
a deliberate position on the same terms-of-service ground, and it's also better product — the BDE's
judgment about fit is the thing worth keeping.

**No fabrication.** See §3. The AI is told never to add what the candidate's own résumé doesn't say.

---

## 7. What success looks like

Numbers the UI should be built to move:

| Metric | Today | Target |
|---|---|---|
| Time per submission | 8–12 min | Under 3 min |
| Submissions per BDE per night | 60–90 | 150+ |
| Follow-ups actually sent | Maybe 30% | Over 90% |
| Applications logged | Inconsistent | 100%, automatically |
| Manager's answer to "who's behind?" | Ask around | Under 5 seconds on one screen |

When a design choice is genuinely ambiguous, pick the one that moves one of these.

---

## 8. Design principles for judgment calls

**Speed over elegance.** A slightly denser layout that saves a scroll wins. This is a tool used for
six hours straight, not a landing page.

**Show the work.** Every number traces to its rows. Every AI output shows what it was derived from.
Every state change is in the ledger. Trust is the product.

**Never lose work.** Optimistic updates, undo toasts, drafts that survive navigation. The BDE is
tired and will misclick — that should cost a second, not a submission.

**Progressive disclosure, not hidden features.** The peek panel exists so he evaluates a job
without navigating. The full detail exists for when he needs it. Neither replaces the other.

**Honest empty states.** First-run teaches. Filtered-to-nothing offers a clear action. Error offers
retry. Using one for all three is the most common way an app feels unfinished.

**Respect the clock.** The shift clock in the topbar is not decoration. A product that knows its
user is racing a clock should say so.

---

## 9. What BenchQ is not

- **Not an ATS.** It doesn't manage the client's hiring process. It manages the firm's outbound.
- **Not a job board.** It doesn't host listings or serve candidates directly.
- **Not an auto-apply bot.** A human decides every submission, deliberately.
- **Not a resume generator.** It drafts, and a human verifies. The distinction is the whole product.
- **Not a candidate-side tool.** The user is the recruiter. The candidate never logs in.

If a feature request would make any of these false, it needs a conversation before it needs a
design.

---

## 10. Scope reminder for this repo

This repository is **frontend only.** No backend, no database, no auth, no LLM calls. AI-generated
content is simulated from fixtures with realistic latency.

Everything in this file is context for making good UI decisions — not a licence to build the
systems behind them. When a task would need a real backend, stop and say so.
