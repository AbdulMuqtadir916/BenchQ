# How BenchQ works: the user flow and the architecture

Two diagrams for the team and for your AI agent (Claude Code, Codex). Each is given as text (Mermaid) so an agent
can read it, with who builds each part. Read with [README.md](./README.md) (owners and rules) and
[00-candidate-core.md](./00-candidate-core.md) (the tables).

## 1. The user flow

![BenchQ user flow](./user-flow.png)

Who does each step: **Owner or manager** (purple), **BDE** (green), **Super Admin or the system** (dark).

```mermaid
flowchart TD
  subgraph S1["1. Setup, once per firm"]
    A1["Create firm<br/>(Super Admin: plan + owner invite)"] --> A2["Owner accepts<br/>(signs in at /firm)"] --> A3["Invite team<br/>(managers and BDEs)"]
  end
  subgraph S2["2. Onboard a candidate (owner or manager)"]
    B1["Upload résumé<br/>(parsed into a draft)"] --> B2["Review profile<br/>(5-step new candidate)"] --> B3["Assign<br/>(manager, then BDE)"]
  end
  subgraph S3["3. The BDE's night, every night"]
    C1["Find jobs<br/>(matched to the candidate)"] --> C2["Favorite<br/>(shortlist jobs)"] --> C3["Tailor résumé<br/>(from the base résumé)"] --> C4["Apply<br/>(via the extension)"]
  end
  subgraph S4["4. Track and oversee"]
    D1["Emails arrive<br/>(the candidate's own inbox)"] --> D2["Status updates<br/>(BDE accepts a suggestion)"] --> D3["Dashboards<br/>(owner and manager view)"]
  end
  A3 --> B1
  B3 --> C1
  C4 --> D1
```

| Step | Who uses it | Status / who builds it | Tables |
|---|---|---|---|
| Create firm, owner accepts, invite team | Super Admin, Owner | **Built** | `firms`, `users`, `invites` |
| Upload résumé, review profile, assign | Owner, Manager | **Built** (onboarding 01–07); profile and Record improvements: **Zuhair** | `candidates`, `resume_parses`, `claims`, `evidence` |
| Find jobs | BDE | **Zuhair** (job scraping per candidate) | `searches`, `candidate_jobs`, `jobs` |
| Favorite | BDE | **Samad** (with the extension) | `favorite_jobs` |
| Tailor résumé (+ ATS score) | BDE | **Zuhair** | `resumes` (base + tailored) |
| Apply | BDE | **Samad** (applications, then the extension) | `applications` |
| Emails arrive, status updates | BDE | **Samad** (inbox first) | `candidate_mailboxes`, `inbox_messages`, `applications` |
| Dashboards | Owner, Manager | Built on mocks; numbers go live as each track does | derived from the tables above, never stored |
| Every request | Everyone | **Uzair** (rate limits, timeouts, logging, then testing) | — |
| Billing, deployment, clean-up | — | **Abdul** | billing tables (new) |

Rules the flow depends on: a candidate always has a manager and at most one BDE (a candidate without a BDE waits in
the manager's "Needs a BDE" queue); an application uses a **tailored** résumé, frozen once sent; nothing is VERIFIED
without evidence; every row carries `firm_id`, and data never crosses firms.

## 2. The architecture

```mermaid
flowchart TD
  U["Firm users<br/>(owner, manager, BDE)"] --> FE
  SA["Super Admin<br/>(BenchQ staff)"] --> FE
  EXT["Extension<br/>(favorite jobs: Samad)"] --> BE
  FE["Next.js frontend<br/>screens → adapters (src/lib/api) → /api proxy"] --> BE
  subgraph BE["FastAPI backend (production layer: Uzair)"]
    AUTH["Auth + tenancy<br/>(Abdul)"]
    CAND["Candidates + Record<br/>(Zuhair)"]
    JOBS["Jobs + tailoring<br/>(Zuhair)"]
    APPS["Applications + inbox<br/>(Samad)"]
    BILL["Billing<br/>(Abdul)"]
  end
  BE --> DB["Postgres<br/>(candidate core tables, ledger)"]
  BE --> X["External services<br/>(AI: Claude · Gmail · job boards)"]
```

- The frontend never calls the backend directly from a screen: screens use hooks, hooks call the adapters in
  `src/lib/api/`, adapters call `http.ts`, and `/api/*` is proxied to FastAPI (`next.config.ts`). Each module is
  served by its mock or the backend, switched with `NEXT_PUBLIC_LIVE_MODULES`.
- The backend checks the session and permissions on every route (`backend/auth/access.py`), reads firm data only
  through `scoped()`, and writes every change to the ledger (`backend/auth/ledger.py`).
- AI calls (résumé parsing, tailoring, ATS) happen only in the backend, never in the frontend.
