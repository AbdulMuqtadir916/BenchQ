import { sameCompany } from "./autofill/job-check";
import type { AppliedForm, PageJob, ResumeFileSource } from "./autofill/types";

export const BENCHQ_URL = __BENCHQ_URL__.replace(/\/$/, "");

type Principal = { kind: "firm" | "platform"; role: string; user_id: string; firm_id?: string };
export type Session = { principal: Principal; user?: { id: string; name: string; role: string }; firm?: { name?: string; slug: string } | null };
type StatusTransition = { from: string | null; to: string };
export type Application = {
  logoUrl?: string;
  id: string;
  candidate_id: string | null;
  status: string;
  title: string | null;
  company: string | null;
  url: string | null;
  location: string | null;
  status_revision?: number;
  status_transitions?: StatusTransition[];
  description?: string | null;
  work_type?: string | null;
  employment_type?: string | null;
  job_type?: string | null;
  arr_remote?: boolean | null;
  arr_hybrid?: boolean | null;
  arr_onsite?: boolean | null;
  remote?: boolean | null;
  salary_min?: number | null;
  salary_max?: number | null;
  posted_at?: string | null;
  discovered_at?: string | null;
  match_score?: number | null;
  best_score?: number | null;
  best_cv_score?: number | null;
  job_id?: string;
  /** The employer's logo its page showed, when the job was added from it (backend/api/routes_applications.py). */
  logo_url?: string | null;
  /** Where BenchQ found the job (`jobs.source`): `jobspy_linkedin`, `linkedin_extension`, `direct`, `manual`… */
  source?: string | null;
  /** The résumé the application was sent with, else the newest one tailored for its job (routes_applications.py). */
  tailored_resume_id?: string | null;
  tailored_resume_name?: string | null;
  tailored_resume_deleted?: boolean;
  has_cover_letter?: boolean;
};

/** Every request says it comes from the extension, so BenchQ can tell what was done here from what was done on the
 * website (the Activity source, planned 2026-11-27). Only BenchQ's own requests carry it, never one to a job's site. */
export const CLIENT_HEADER = "X-BenchQ-Client";

async function send(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${BENCHQ_URL}${path}`, {
    ...init, credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}), [CLIENT_HEADER]: "extension" },
  }).catch(() => {
    throw Object.assign(new Error("BenchQ can't be reached. Check your connection, or that BenchQ is running, and try again."), { status: 0 });
  });
  if (!response.ok) throw Object.assign(new Error(response.status === 401 ? "SESSION_EXPIRED" : await failureOf(response)), { status: response.status });
  return response;
}

/** What went wrong, in words the BDE can act on: BenchQ's own reason when it gives one for a refused request, else what
 * the answer means. Never a bare status code. */
async function failureOf(response: Response): Promise<string> {
  const detail = response.status < 500
    ? await response.json().then((body: { detail?: unknown }) => (typeof body?.detail === "string" ? body.detail : ""), () => "")
    : "";
  if (detail) return detail;
  if (response.status === 403) return "You don't have access to this. Ask your manager if you should.";
  if (response.status === 404) return "BenchQ couldn't find this any more. Refresh and try again.";
  if (response.status === 409) return "This changed in BenchQ meanwhile. Refresh and try again.";
  if (response.status === 413) return "That's too large for BenchQ to take.";
  if (response.status === 429) return "Too many requests just now. Wait a moment and try again.";
  if (response.status >= 500) return "BenchQ had a problem on its side. Try again in a moment.";
  return "BenchQ couldn't take this as it was sent. Refresh the page and try again.";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

/** Bytes as base64, in slices: a whole file at once would overflow the call stack. */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

export const isSessionExpired = (error: unknown) => error instanceof Error && error.message === "SESSION_EXPIRED";

/** Signs the BDE out of BenchQ, as the website's Sign out does (routes_auth.py: 204, even with no session left). */
export const signOut = () => request<void>("/api/auth/sign-out", { method: "POST" });

/** The candidate's Resumes tab on the website: `candidates.detail` in src/lib/routes/registry.ts, tab `resumes`. The
 * website reads the backend's candidate id as it is while candidates run on the backend. */
export const candidateResumesUrl = (firmSlug: string, candidateId: string) =>
  `${BENCHQ_URL}/${encodeURIComponent(firmSlug)}/candidates/${encodeURIComponent(candidateId)}?tab=resumes`;

/** One application on the website: `applications.detail` in src/lib/routes/registry.ts, for "View in BenchQ" once the
 * BDE marks a job applied. */
export const applicationUrl = (firmSlug: string, applicationId: string) =>
  `${BENCHQ_URL}/${encodeURIComponent(firmSlug)}/applications/${encodeURIComponent(applicationId)}`;

/** One résumé version in the studio on the website: `resumes.studio` in src/lib/routes/registry.ts, whose URL names
 * the version. */
export const resumeStudioUrl = (firmSlug: string, versionId: string) =>
  `${BENCHQ_URL}/${encodeURIComponent(firmSlug)}/resumes/${encodeURIComponent(versionId)}`;

export const getSession = () => request<Session>("/api/auth/me");

/** One of a job's cover letters in BenchQ (backend/api/routes_cover_letters.py `_to_dict`): its name and when it last
 * changed, never its text. */
export type CoverLetter = { id: string; name: string | null; job_id: string | null; updated_at: string | null; created_at: string | null };

/** The connected candidate's letters for this application, newest first. */
export const getCoverLetters = async (applicationId: string): Promise<CoverLetter[]> => {
  const result = await request<{ letters: CoverLetter[] }>(`/api/cover-letters?application_id=${encodeURIComponent(applicationId)}`);
  if (!Array.isArray(result?.letters)) throw new Error("Application cover letters unavailable");
  return result.letters;
};

/** A cover letter as a PDF, its type and its bytes in base64, for the form's cover-letter upload. Null when it's not
 * found. */
export async function getCoverLetterFile(id: string, applicationId: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const response = await send(`/api/cover-letters/${encodeURIComponent(id)}/pdf?application_id=${encodeURIComponent(applicationId)}`);
    const mimeType = (response.headers.get("Content-Type") ?? "").split(";")[0]!.trim() || "application/pdf";
    return { mimeType, data: base64Of(new Uint8Array(await response.arrayBuffer())) };
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}
export type Candidate = { id: string; full_name: string };

export const getCandidates = (firmId: string) =>
  request<Candidate[]>(`/api/firms/${encodeURIComponent(firmId)}/candidates`);

/** One version in a candidate's résumé list: its details, never its content (backend/candidates/versions.py). */
export type ResumeVersion = { id: string; version: number; name: string; title: string | null; category: string; job_id: string | null; created_at?: string | null };
export type ResumeBase = { id: string; number: number; is_active: boolean; archived_at: string | null; versions: ResumeVersion[] };
export type TailoredResume = { base_resume_id: string; job_id: string; versions: ResumeVersion[] };
export type ResumeListing = { bases: ResumeBase[]; tailored: TailoredResume[] };

/** One answer of a résumé version's autofill (docs/02 §8.1). Answers keep their JSON type; `key` names what a fixed
 * question asks. */
export type ResumeAnswer = { question: string; answer: unknown; kind: "FIXED" | "EDITED" | "CUSTOM"; key?: string; built?: unknown };

const candidatePath = (firmId: string, candidateId: string) =>
  `/api/firms/${encodeURIComponent(firmId)}/candidates/${encodeURIComponent(candidateId)}`;

export const getResumeListing = (firmId: string, candidateId: string) =>
  request<ResumeListing>(`${candidatePath(firmId, candidateId)}/resumes`);

/** A version's autofill, held in memory while a tab is reviewed and never stored. Null from a backend that doesn't send
 * one yet: it ignores `?autofill=true` and answers with the content alone. */
export async function getResumeAnswers(firmId: string, candidateId: string, resumeId: string): Promise<unknown[] | null> {
  const version = await request<{ autofill?: unknown }>(`${candidatePath(firmId, candidateId)}/resumes/${encodeURIComponent(resumeId)}?autofill=true`);
  return Array.isArray(version?.autofill) ? version.autofill : null;
}

/** A résumé version's file, its type and its bytes in base64, held in memory while a tab is reviewed (docs/02 §8.2): an
 * uploaded base's first version as it was uploaded (`source` "uploaded"), any other made by BenchQ from the version's
 * text ("generated"). `format` asks for a PDF or Word file, for an upload that takes only one. Null when it's not found. */
export async function getResumeFile(firmId: string, candidateId: string, resumeId: string, format?: "pdf" | "docx"): Promise<{ mimeType: string; data: string; source?: ResumeFileSource } | null> {
  try {
    const query = format ? `?format=${format}` : "";
    const response = await send(`${candidatePath(firmId, candidateId)}/resumes/${encodeURIComponent(resumeId)}/file${query}`);
    const mimeType = (response.headers.get("Content-Type") ?? "").split(";")[0]!.trim();
    const source = response.headers.get("X-Resume-File");
    return { mimeType, data: base64Of(new Uint8Array(await response.arrayBuffer())), ...(source === "uploaded" || source === "generated" ? { source } : {}) };
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

/** A tailoring of the candidate's résumé for one of their jobs, as BenchQ reports it (backend/resume_tailor/runs.py
 * `run_json`): running with its step, completed with the new résumé, or failed with its reason's code. */
export type TailoringRun = {
  run_id: string;
  status: "running" | "completed" | "failed";
  step?: string | null;
  resume_id: string | null;
  error_code: string | null;
  job_posting_id?: string | null;
  /** The base version it reads: a start refused because this one already runs follows only a run of the same source. */
  source_resume_id?: string | null;
  started_at: string | null;
};

/** Starts tailoring the candidate's résumé for one of their jobs (backend/api/routes_resume_tailoring.py, as the
 * website's Tailor button does): about a minute, in the background. `resumeId`: the base version it reads; none: the
 * active base's v1. Its run id. */
export const startTailoring = (firmId: string, candidateId: string, jobPostingId: string, resumeId: string | null) =>
  request<{ run_id: string }>(`${candidatePath(firmId, candidateId)}/resumes/tailor`, {
    method: "POST",
    body: JSON.stringify({ job_posting_id: jobPostingId, ...(resumeId ? { resume_id: resumeId } : {}) }),
  });

/** One tailoring's status, read again while it runs. */
export const getTailoring = (firmId: string, candidateId: string, runId: string) =>
  request<TailoringRun>(`${candidatePath(firmId, candidateId)}/resumes/tailorings/${encodeURIComponent(runId)}`);

/** The candidate's tailorings still running, newest first: one for this job started on the website shows here too. */
export const getRunningTailorings = (firmId: string, candidateId: string) =>
  request<TailoringRun[]>(`${candidatePath(firmId, candidateId)}/resumes/tailorings?running=true`);

/** Keeps answers the BDE typed on a résumé version's autofill, for next time: phase 3's save route (docs/02 §8.4). */
export const saveResumeAnswers = (firmId: string, candidateId: string, resumeId: string, change: object) =>
  request<unknown>(`${candidatePath(firmId, candidateId)}/resumes/${encodeURIComponent(resumeId)}/autofill`, { method: "PATCH", body: JSON.stringify(change) });

const PAGE = 2000;

/** Every page of a list of applications: the backend pages by `offset`. */
async function allApplications(query: string): Promise<Application[]> {
  // By application id: a save between two pages can move a row onto the next page as well.
  const found = new Map<string, Application>();
  for (let offset = 0; ; offset += PAGE) {
    const { applications } = await request<{ applications: Application[] }>(
      `/api/applications?${query}&limit=${PAGE}${offset ? `&offset=${offset}` : ""}`);
    for (const application of applications) found.set(application.id, application);
    if (applications.length < PAGE) return [...found.values()];
  }
}

/** A candidate's saved jobs, or, without one, the saved jobs of every candidate this user can see. */
export const getSavedApplications = async (candidateId?: string) => {
  const candidate = candidateId ? `&candidate_id=${encodeURIComponent(candidateId)}` : "";
  const [saved, applied] = await Promise.all([
    allApplications(`status=saved&tracked_only=true${candidate}`),
    allApplications(`status=applied&tracked_only=true${candidate}`),
  ]);
  const savedIds = new Set(saved.map((application) => application.id));
  const appliedFromSaved = applied.filter((application) =>
    !savedIds.has(application.id) && application.status_transitions?.some(
      (transition) => transition.from === "saved" && transition.to === "applied",
    ),
  );
  // The logo BenchQ saved with the job, else the one this browser kept for it (jobs added before BenchQ kept logos).
  const jobs = [...saved, ...appliedFromSaved].map((job) => (isLogoLink(job.logo_url) ? { ...job, logoUrl: job.logo_url } : job));
  const keys = jobs.filter((job) => !job.logoUrl).map(job => logoKey(job.id));
  if (!keys.length || typeof chrome === "undefined" || !chrome.storage?.local) return jobs;
  const logos = await chrome.storage.local.get(keys).catch(() => ({} as Record<string, unknown>));
  return jobs.map(job => {
    if (job.logoUrl) return job;
    const logo = logos[logoKey(job.id)] as { company?: string; url?: string } | undefined;
    // The company it was saved for, however BenchQ spells it now ("Acme Inc" and "Acme, Inc." are one company).
    return logo?.company && typeof logo.url === "string" && (logo.company === job.company || sameCompany(logo.company, job.company))
      ? { ...job, logoUrl: logo.url } : job;
  });
};
/** Marks the job applied with the form as it stood and, when known, the résumé version its answers came from: the one
 * sent (docs/02 §9). */
/** A job added for a candidate from the page it's on (the add-job plan, 2026-11-11): it becomes one of their jobs and a
 * Saved application at once, or the application they already have for it. */
/** One of a candidate's jobs in BenchQ, the posting the website's Open source names. For the job's details page, what
 * BenchQ holds besides: its employment type, work mode and posted date; and, for a job added from its page, what the
 * page stated (its pay, requisition), its logo and its description as the page gave it (`descriptionHtml`). */
export interface BenchqJob {
  id: string; title: string | null; company: string | null; location: string | null; description: string | null; url: string | null;
  employmentType?: string | null; workMode?: "remote" | "hybrid" | "onsite" | null; postedAt?: string | null;
  salaryMin?: number | null; salaryMax?: number | null; salaryCurrency?: string | null; salaryPeriod?: PageJob["salaryPeriod"] | null;
  requisitionId?: string | null; logoUrl?: string; descriptionHtml?: string | null;
}

type PostingJson = {
  id: string; title: string | null; company: string | null; location: string | null; description?: string | null; apply_url: string | null;
  employment_type?: string | null; remote_mode?: string | null; posted_at?: string | null;
  work_mode?: string | null; salary_min?: number | null; salary_max?: number | null; salary_currency?: string | null;
  salary_period?: string | null; requisition_id?: string | null; logo_url?: string | null; description_html?: string | null;
};
const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
const PAY_PERIODS = ["hour", "day", "week", "month", "year"] as const;
/** The work mode BenchQ worked out for a posting (`remote_mode`): remote or hybrid as the source or place says. Its
 * ONSITE is also what it says when nothing does, so it isn't taken as stated. */
const REMOTE_MODES = { REMOTE: "remote", HYBRID: "hybrid" } as const;
const oneOf = <T extends string>(values: readonly T[], value: string | null | undefined): T | null =>
  (values as readonly string[]).includes(value ?? "") ? value as T : null;
/** A logo link the panel shows: http(s), as BenchQ takes one. */
const isLogoLink = (url: string | null | undefined): url is string => typeof url === "string" && /^https?:\/\/[^\s/]/i.test(url) && url.length <= 2048;

/** backend/api/routes_job_search.py: the candidate's own posting, or a 404 when the job isn't theirs. */
export const getCandidateJob = async (firmId: string, candidateId: string, postingId: string): Promise<BenchqJob> => {
  const posting = await request<PostingJson>(`${candidatePath(firmId, candidateId)}/job-postings/${encodeURIComponent(postingId)}`);
  const mode = (posting.remote_mode ?? "").toUpperCase();
  return { id: posting.id, title: posting.title, company: posting.company, location: posting.location,
    description: posting.description ?? null, url: posting.apply_url, employmentType: posting.employment_type ?? null,
    workMode: oneOf(WORK_MODES, posting.work_mode) ?? (mode in REMOTE_MODES ? REMOTE_MODES[mode as keyof typeof REMOTE_MODES] : null),
    postedAt: posting.posted_at ?? null, salaryMin: posting.salary_min ?? null, salaryMax: posting.salary_max ?? null,
    salaryCurrency: posting.salary_currency ?? null, salaryPeriod: oneOf(PAY_PERIODS, posting.salary_period),
    requisitionId: posting.requisition_id ?? null, ...(isLogoLink(posting.logo_url) ? { logoUrl: posting.logo_url } : {}),
    descriptionHtml: posting.description_html ?? null };
};

type AddedApplication = Application & { job_created: boolean; application_created: boolean };

const logoKey = (applicationId: string) => `job-logo:${BENCHQ_URL}:${applicationId}`;

/** Saves a job for the candidate: a job BenchQ already has by its id, any other from what its page stated. */
export const addJob = async (candidateId: string, job: PageJob, known?: BenchqJob): Promise<AddedApplication> => {
  const application = await saveApplication(candidateId, job, known);
  // The page's logo, for the company BenchQ saved: BenchQ may tidy its name, never make it another company's.
  if (!job.logoUrl || (job.company !== application.company && !sameCompany(job.company, application.company))) return application;
  // BenchQ's job records have no logo field: the page's public image goes with this saved application, in this browser,
  // so the panel shows it wherever it shows the job (its card, the Autofill page, its details, Applied).
  if (typeof chrome !== "undefined") await chrome.storage?.local?.set({ [logoKey(application.id)]: { company: application.company ?? job.company, url: job.logoUrl } }).catch(() => undefined);
  return { ...application, logoUrl: job.logoUrl };
};

const saveApplication = async (candidateId: string, job: PageJob, known?: BenchqJob): Promise<AddedApplication> => {
  if (known) {
    const saved = await request<{ id: string; job_id: string; candidate_id: string; status: string }>("/api/applications", {
      method: "POST", body: JSON.stringify({ candidate_id: candidateId, job_id: known.id, status: "saved" }),
    });
    return { ...saved, title: known.title, company: known.company, location: known.location, url: known.url, job_created: false, application_created: true } as AddedApplication;
  }
  return request<AddedApplication>("/api/applications", {
    method: "POST",
    body: JSON.stringify({
      candidate_id: candidateId,
      job: {
        source: "extension", title: job.title, company: job.company, description: job.description, url: job.postingUrl ?? job.url, location: job.location,
        // What the page stated besides; a detail it didn't state is left out (JSON drops undefined).
        work_mode: job.workMode, employment_type: job.employmentType, salary_min: job.salaryMin, salary_max: job.salaryMax,
        salary_currency: job.salaryCurrency, salary_period: job.salaryPeriod, posted_at: job.postedAt, requisition_id: job.requisitionId,
        // The employer's logo the page shows, saved with the job so the panel shows it with the job anywhere.
        logo_url: isLogoLink(job.logoUrl) ? job.logoUrl : undefined,
      },
    }),
  });
};

export const markApplied = (application: Application, form: AppliedForm, resumeId: string | null = null) => request<Application>(`/api/applications/${encodeURIComponent(application.id)}/candidate-status`, {
  method: "PATCH",
  body: JSON.stringify({
    status: "applied", expected_revision: application.status_revision ?? 0, command_id: crypto.randomUUID(), form_data: form,
    ...(resumeId ? { resume_id: resumeId } : {}),
  }),
});
