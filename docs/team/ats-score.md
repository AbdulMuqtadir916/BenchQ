# The Match score

How well a candidate's résumé fits one job, 0–100: the number on the job list, the job pane, the job page, the
application page, Overview's best matches, Focus, the BDE dashboard, and the "Resume sent" tag. Decided by Zuhair on
2026-11-14 (Q30–Q49 in the job-search grilling); built in `feat/job-search-indeed-and-candidate-details`.

It is called **Match**, not "ATS score": it ranks a candidate's jobs; it doesn't predict any employer's applicant
tracking system.

## What it is

Plain code, no AI model: nothing leaves the server, it costs nothing, and it takes about 10 ms a job. It is the ATS
lab's "v18" of 2026-11-13: JobNavigator's match-1.1 with the lab's patches and three BenchQ changes, copied into
`backend/match/` (the list of files and changes is in [`backend/UPSTREAM.md`](../../backend/UPSTREAM.md)).
`backend/match/score.py` is the only door into it; `backend/match/store.py` stores what it works out.

The version is `match-1.6+benchq.1` (`backend/match/ats_match.py` `VERSION`). Changing the calculator means changing
the version: every stored score is then worked out again (below).

## What it compares

One résumé against one job's text. The résumé is the candidate's **active résumé's version 1** (the one tailoring
starts from), read as tailoring reads it. A tailored version is scored against its own job.

The parts, each worth points when the posting states it (a part the posting says nothing about is left out and its
points shared among the rest):

| Part | Points | What counts |
|---|---|---|
| Technologies the job asks for | 35 | each one the résumé names: in full when a role used it, 0.4 when only the skills list names it |
| Job title | 20 | how close the job's title is to the titles the candidate wants (target roles, "Marketed as") and the résumé's |
| Requirement lines covered | 10 | the posting's requirement lines the résumé covers |
| Years of experience | 10 | the years asked against the candidate's years |
| Level | 5 | junior / mid / senior against the candidate's |
| Degree | 5 | the degree asked against the résumé's |
| Certifications | 5 | the ones asked that the résumé names |
| Soft skills and other keywords | 5 | |
| Industry | 5 | |

The total is then scaled by the share of the job's main technologies the candidate has used in a role (keeping no
less than 40% of it).

## What holds it at 40

A score is **held at 40** (never more) when a recruiter would screen the candidate out before reading:

- the job's title names another subject ("Sales Account Executive" for a Java developer), or it is another kind of
  role;
- it asks far more years than the résumé covers, or its level is two rungs away;
- it requires a degree, a certification or a language the résumé doesn't have;
- the posting is in another country;
- it says no C2C and the candidate works only C2C or 1099;
- its work-authorization terms rule the candidate out (below).

The first reason is stored with the score (`match_note`) and shown when the pointer rests on a held score: "Held at
40: no C2C or third-party candidates; the candidate works only C2C or 1099".

## Work authorization: left out, not held

A search **leaves out** a job whose text rules the candidate out on work authorization (`score.ruled_out`): no
sponsorship for a candidate who needs it, US citizens only, citizens or green-card holders only, a list of the only
statuses taken that leaves theirs out (or one that excludes it), an active clearance for a non-citizen, no H-1B
transfers for a candidate who needs one. The search's result counts them ("N left out: work authorization"). A
capture is never left out; its score is held at 40 instead. A posting that says nothing keeps the job.

## When it is worked out

Each stored score keeps `match_basis`: a SHA-256 of everything it was worked out from (the calculator's version, the
résumé version, the candidate's fields it reads, the job's text). A score is worked out again only when that no
longer matches. So:

- a search or a capture scores each job as it saves it;
- a finished tailoring scores its version against the job;
- a résumé change (save, use as base, upload, delete a base) or an edit to a field the score reads (role, target
  role, years, work authorization, sponsorship, transfer, engagement types) re-scores the candidate after the
  response;
- when the backend starts, one thread scores every job and tailored version whose score is missing or out of date
  (a Postgres advisory lock, so one process does it; logs counts only). `MATCH_PASS_ON_START=false` turns it off.

A score that can't be worked out never fails a save: the job stays unscored ("—") and the next pass tries again.

## On the screens

- A candidate's job list opens at "Any score", best Match first; the score filter offers 70+, 85+ and 95+. The list
  is sorted and filtered by the backend, 100 at a time with "Load more".
- "All candidates" has no Match (there is no one candidate); picking a candidate shows theirs.
- The job page's candidate picker lists the candidates who have the job; each has their own Match.
- The job page's "Run full analysis" is a placeholder kept for later (its Have / Missing / Adjacent list compares
  words in the browser; no AI runs). The Match card's number is the real score.

## Limits

- A posting cut short scores lower than the whole posting would: Indeed sends whole postings; freehire.me jobs saved
  before 2026-11-14 keep the ~1,000 characters the search gave unless they were opened.
- Each list read reads every visible job's fields (not its description) to filter and sort: fine for a candidate's
  or a team's few thousand jobs; a firm with far more would need these fields as columns.
- The calculator reads text, not meaning: a job that is the same work under a very different title can score low.
  The lab tried an AI "decider" for that (2026-11-13); it isn't part of this (Q31).
