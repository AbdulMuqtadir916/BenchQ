# PR 4 — problems found and proposed solutions (for review, nothing implemented)

Status: **draft for Samad's review, 2026-11-05.** No code has been changed for any item here. After approval, a
separate `CODE_CORRECTION_PLAN.md` will turn the approved items into tasks.

Sources read for this document: `docs/team/samad.md`, `docs/integration/pr3-email-classification/*`, PR #111 review,
issue #110, `docs/02-DATA-CONTRACTS.md` §2.1, `docs/integration/03-applications.md`, `06-open-decisions.md` (D3),
`08-ai-presets.md`, `docs/team/pr-changes/codex-pr3-local-review.md`, the combined code in `~/Documents/inbox`
(PR 95, draft), and the merged PR 3 code on main.

How to read each item: **Problem** (plain words) → **Evidence** → **Options** → **Recommendation** → **Needs**.

## Corrections to my earlier audit (what the docs say)

| Earlier claim | What the docs say | Result |
|---|---|---|
| "Sender check is too strict" | `samad.md` §1.2(4) and `OPERATIONS.md` **require** it for PR 4 and describe it as *exact-domain aligned DMARC or SPF+DKIM, no ARC*. What is deferred is the **manual sender allowlist** and the **relevance prefilter**, not sender authentication. | Not a bug. Removed from the error list; kept as an optional later tuning question (P6). |
| "Regex truncation is code that should not exist" | The *prefilter / local classifier* is deferred (`samad.md` §1.6). No regex anywhere decides a category. The quote/signature cleaning is listed in `codex-pr3-local-review.md` as part of PR 3 matching. | The cleaning is **in scope**, but it is also fed to the AI, and a `From:` line can blank the text. Real problem, smaller than I said (P5). |
| "AI config falls back to claude_api = bug" | `OPERATIONS.md` says set `candidate_email_llm_provider/model/api_key` and use OpenRouter Decisions only. | The code matches the docs. The only real gap is that an empty setting silently falls back to the primary provider instead of stopping (P18). |
| I wrote the settings as `email_classification_llm_*` | Correct names are `candidate_email_llm_*`. | My mistake, corrected. |

---

## P1 — Two confidence numbers must match exactly

**Problem.** The Decisions API answers one multiple-choice question and returns *two* numbers: `probabilities` (one
number per category) and a separate `confidence`. The code requires `confidence == probabilities[chosen]` within
0.000001. Real answers differ slightly (seen live: 0.9650 vs 0.9685), so every real email fails `INVALID_CONFIDENCE`.
**Why two:** the provider computes the headline confidence separately from the raw per-category probabilities, so they
are close but not identical.
**Evidence.** `backend/inbox/decider.py:65`; live reply; the combined code (`~/Documents/inbox`) already tolerates it.

**Options.**
- A. Use the provider's `confidence` if it is a number 0–1 (what PR 95 and the reference project do).
- B. Always use the chosen category's probability.
- C. Accept both only if they are within a small tolerance (e.g. 0.05, wider than the sum check's 0.02); otherwise
  reject as inconsistent. Store both numbers.
- D. C, and use the **lower** of the two for every threshold decision, so automation is never more confident than
  either number.

**Recommendation: D.** It keeps your "add a check" idea, still catches a malformed reply, and is the safest for
automatic updates. The tolerance value should be confirmed against the 24 labelled examples before it is fixed.
**Needs.** A small change to merged PR 3 code (decider + its tests). Tell Abdul in the PR note.

## P2 — Review must be possible on every stage

**Problem.** The review form should let a BDE confirm *any* application stage, not a reduced list.
**Evidence.** Main's review route accepts all ten statuses (`tracking.py` `STATUSES`). The conflict is in the docs:
`docs/02 §2.1` says Incomplete application is shown **only with explicit incomplete-email evidence**.
**Options.** A. All ten always. B. All ten, with Incomplete application offered when the email itself is classified
incomplete *or* the application is already Incomplete. C. All ten except Saved (a review confirms a response from an
employer, so moving back to Saved makes little sense).
**Recommendation: C + B's Incomplete rule.** Saved is excluded by choice; the two you named are fully covered.
**Needs.** Your decision on Saved and on the Incomplete rule (the doc wording would be updated to match).

## P3 — Moving Saved → any stage except Applied loses the "submitted" facts

**Problem.** Moving Saved → Applied records the time and who submitted it. Moving Saved → Screening call (allowed)
records neither. The matcher and the review dropdown only treat an application as *submitted* when `applied_at` or
the submitter is set, so that application can never match an email and disappears from the review choices.
**Evidence.** `backend/applications/tracking.py:93` (only `status == 'applied'`); `application_matching.py:70`.
**Options.** A. Record submitted time and actor whenever an application leaves Saved for *any* stage. B. Forbid
direct jumps out of Saved. C. Keep as is and fix the matcher.
**Recommendation: A.** One rule ("leaving Saved means it was submitted") in the single shared move path. Moving back
to Saved keeps the submission facts (the existing code comment already says Saved changes the queue, not the history).
**Needs.** Confirm A; a unit test per target status.

## P4 — Dismiss can link the email and can fail on an unrelated revision

**Problem.** If an application id is sent with Dismiss, the email is linked to it before being dismissed, and a stale
application revision makes the dismissal fail.
**Evidence.** `routes_inbox.py:658–673`.
**Recommendation.** Dismiss never uses an application at all: ignore any application fields, never link, never check
an application revision. Only the review revision and the email content revision are checked.
**Open question for you:** you wrote "how we use disconnect". I could not find an "unlink email from application"
action in the docs or code (mailbox *disconnect* is a different feature). If you want a way to detach a wrongly linked
email, that is a new feature and needs a decision.
**Needs.** Your answer on the question above.

## P5 — Cleaning of the email text can leave almost nothing

**Problem.** Before matching *and* before the AI call, the body is cut at the first line that looks like a quoted
reply, a signature, or a line starting with `From:` / `Regards,`. A forwarded message that starts with `From:` becomes
empty, so nothing matches and the AI sees almost no text.
**Evidence.** `application_matching.py:147–162`; the cleaning is documented as part of PR 3 matching in
`codex-pr3-local-review.md`. The deferred item is the relevance prefilter, which does not exist in the code.
**Options.** A. Keep cleaning for *matching only*; send the AI the full redacted, size-bounded body. B. Keep cleaning
for both but only remove real quoted blocks (`>` lines, `On … wrote:` onward) and never cut at `From:`/`Regards`.
C. A or B plus a safety rule: if cleaning removes more than about 80% of the text, use the uncleaned text.
**Recommendation: A + C.** It matches the docs ("redact/minimize", "bounded"), and the AI is the better judge of
signatures.
**Needs.** Your confirmation that the AI may receive the un-stripped (redacted) body.

## P6 — Sender verification (kept, not a bug)

Required by the approved plan (exact-domain alignment is the documented parser behaviour). Side effect to know about:
mail sent through an ATS subdomain or forwarded will be "sender unverified" and always go to review, so automatic
updates will fire less often than you might expect. **Recommendation:** keep as is for PR 4; after real use, measure
how much recruiter mail is PASS, and only then ask Abdul whether to relax to organizational-domain matching.
**Needs.** Nothing now.

## P7 — Review list order and missing subject/sender

**Problem.** The list is ordered by the review's random id, and shows no subject or sender.
**Recommendation (easy, yes).** Order by creation date, newest first, with a cursor on (date, id); return subject,
sender and total count so cards are readable.
**Needs.** Backend response gains optional fields; documented in docs/02.

## P8 — Matching reloads every company for every email

**Problem.** Each email loads the whole company table and rebuilds aliases.
**Recommendation.** Load aliases only for the companies of *this candidate's submitted applications*, once per batch.
Small, no behaviour change; add a test that results are identical.

## P9 — Reclassify cost

**Problem as I wrote it was overstated.** Retry only works on emails in `ERROR` (failure is retried, as you said).
Reclassify is an explicit Owner/Manager action approved by Abdul. What is *not* limited is how often a person can
press it.
**Recommendation.** Optional, low priority: one reclassify per email per 10 minutes, and count each call in AI spend
(already required, P22). Skip it if you prefer.

## P10 — Inbox badges and the "Email: Email" title

**Problem.** Badge shows only "Classified"; unqueued mail shows "Email: Email" (`activity-tab.tsx`,
`attention-card.tsx`, flagged by Abdul).
**Recommendation.** One map of the ten categories → label, icon, tone (never colour alone); fix the empty-label
fallback so "Not classified" or the real subject shows. Frontend only.

## P11 — "Completed application" email should return Incomplete → Applied

**Your point.** If the candidate completes an incomplete application, the confirmation email is an *applied* email,
so the state should simply move back to Applied.
**What the docs say.** #110 requested this (≥0.6); `docs/02 §2.1` says these special Applied/Incomplete transitions
"are not added to the approved five-target allowlist" until sign-off. In code today, an email on an Incomplete
application always goes to review (`policy.py`, status not in the stage list).
**Recommendation.** Add one narrow rule: category `applied` on an application whose status is `incomplete_application`,
fresh + unique match + sender PASS + confidence ≥0.8 → Applied (automatic, with Undo). Everything else on Incomplete
still goes to review.
**Needs.** Abdul's sign-off (it extends the approved list).

## P12 — Test emails are "stale"

Expected: an email received before an application's apply/last-change time is stale and goes to review. For testing,
send a **new** email after moving the application to Applied. No code change.

## P13 — Why earlier emails are not classified once classification is on

**Explanation.** By Abdul's required change on PR 111, only mail **imported after** classification is switched on is
queued (`PENDING`). Mail already imported, or imported while off, is `NOT_QUEUED` and is never picked up later; Retry
only works on `ERROR`, Reclassify only on `DONE`. This protects against sending months of old mail to an external AI
at once.
**Solution.** An explicit, separate "Classify existing mail" action (Owner/Manager): shows how many emails and an
estimated cost, limited to the current connected mailbox and a chosen date window, processes oldest → newest. Because
of the freshness rule, old mail can only create reviews, never silent status changes.
**Right now (testing):** the 85 emails in `ERROR` can use **Retry** once the classifier is configured.
**Needs.** Abdul said this is a later PR; confirm whether it is in PR 4 or after.

## P14 — Frontend revision tracking (my recommendation: store it on the application)

**Problem.** The backend requires the application's current revision with every move. My adapter keeps it in a hidden
in-memory map that is lost on reload and can be stale.
**Options.** A. Keep the map. B. **Add `statusRevision` to the application schema**, filled from every read, sent
with every move, bumped by the optimistic update. C. Re-fetch before every move. D. Make the backend revision optional
(weakens its conflict protection).
**Recommendation: B.** No hidden state; survives reload and several tabs; costs no extra request; a 409 then means a
real conflict and the board refetches.
**Needs.** Schema addition = your/Abdul's sign-off (CLAUDE.md: contracts first in docs/02).

## P15 — "Some statuses are hidden" (the explanation you asked for)

**What happens.** The backend can now store ten statuses (`screening_call`, `shortlisted`, …). The frontend's list of
statuses is still the **old** one (Response, Screening, Interview, Placed…), and the screens only know how to draw
those. My adapter converts only statuses with the same name (`saved`, `applied`, `offer`). For any other backend
status, it **skips the row** so nothing crashes.
**Why that matters.** Once any application reaches Screening call (by a BDE or the classifier), it vanishes from the
board and lists, board totals drop, and the candidate's counters (Applications, Active) come out too low — even though
the data is correct in the database.
**What the docs say.** `docs/02 §2.1`: the frontend target values are simply the upper-cased backend names
(`SCREENING_CALL`, …). Old values must be shown as "legacy", and an unknown value must be shown with a safe label and
sent to review — **never hidden and never turned into Applied**.
**Solution.** Update the frontend status list to the ten target values plus a read-only legacy group (all drawn from
one place, `status-meta.ts`), so every status is shown. This is the vocabulary work the docs gate on Abdul's sign-off.
**Needs.** Abdul's sign-off on the §2.1 mapping before this is done. Until then the skip stays (a known limit).

## P16 — Move fails on `http://192.168.x.x`

**Problem.** `crypto.randomUUID()` exists only on secure pages (https or `localhost`). Opening the app by network
address (for example on a phone to test 390 px) makes it undefined, so clicking Move throws.
**Recommendation (easy).** One small helper `newCommandId()` that uses `crypto.randomUUID()` when present and builds a
UUID from `crypto.getRandomValues` otherwise; unit test for both paths.

## P17 — "Interface briefly shows rejected changes" (the explanation you asked for)

**What happens.** When you move a card, the board updates immediately, *before* the server answers, so it feels
instant ("optimistic update"). If the server then refuses (not allowed, stale, no permission), the card jumps back.
So for a moment the screen showed a change that never happened.
**Why it matters.** At 11 pm a card that appears to move and then snaps back can be mistaken for success.
**Solutions.** A. Keep optimistic moves, but block moves we already know are invalid *before* any change (disabled
button with the reason). B. Show the card as "saving…" and move it only on success. C. Keep as is.
**Recommendation: A + a clear message on rollback.** Fast in the normal case, honest in the rare one.

## P18 — AI settings and the OpenRouter-only rule

**Docs.** `OPERATIONS.md`: set `candidate_email_llm_provider`, `_model`, `_api_key` (and optional effort/instructions)
through `ai_config("email_classification")`; the intended model is Perplexity Decider via OpenRouter Decisions.
**Gap.** If those settings are empty, the shared loader quietly falls back to the **primary** provider/model, which is
not OpenRouter, so every email fails later with `CLASSIFIER_NOT_CONFIGURED`.
**Recommendation.** For this module, never fall back to the primary provider: empty setting ⇒ "not configured".
Setup is documented as a checklist in OPERATIONS.md (names, values, where the key lives).
**Needs.** Writing the three setting rows is a dev-database write; do it only on your approval.

## P19 — One missing setting turns the whole backlog into errors

**Problem.** The worker claims each email (counting an attempt) before checking the configuration. A missing
configuration or a rejected key is treated as a permanent failure, so all 85 emails went to `ERROR` at once.
**Recommendation.** Check configuration before claiming. If it is missing, leave the emails `PENDING` and report
"classifier not configured" once. A rejected key (401/403) pauses the queue instead of failing each email.

## P20 — The review can set any status

Covered by P2: the review accepts exactly the allowed list chosen there; Saved excluded.

## P21 — Adapter error for a status the backend cannot take

`03-applications.md` specifies code `UNSUPPORTED_STATUS` and the message "BenchQ can't move an application to
<status> yet." My adapter uses `BAD_REQUEST`. **Fix:** use the documented code and message.

## P22 — Abdul's two conditions before anyone switches classification on

1. Decide the endpoint: confirm the alpha OpenRouter Decisions API is reliable enough (P1 is evidence of its
   quirks), or move the call to the shared `backend/analyzer/llm_client.py`.
2. Count classification calls in the Super Admin AI-spend totals.
3. Add both as a **switch-on blocker** in `OPERATIONS.md` in PR 4.
**Recommendation.** Keep the Decisions endpoint (it returns the per-category probabilities we use), add a strict
response check (P1), and record every call's usage in the existing job-run metadata so the AI-spend card can sum it.

## P23 — Application list is capped at 200

The adapter sends no limit, so the backend default (200) silently truncates. `03-applications.md` says to request up
to 2000. **Fix:** send `limit=2000` and show a notice if `total` is larger.

---

## Decisions I need from you

1. P1: option D (and the tolerance after checking the 24 examples)?
2. P2: all stages except Saved; Incomplete rule?
3. P3: record "submitted" whenever an application leaves Saved?
4. P4: what did you mean by "disconnect"?
5. P5: may the AI receive the full redacted body?
6. P11 / P13 / P15: which of these need Abdul before we build, and which do we defer?
7. P14: add `statusRevision` to the application schema (my pick)?
8. P18: may I write the three `candidate_email_llm_*` settings in the dev database when we reach testing?
