import type { AppliedForm, PageJob } from "./autofill/types";

export const BENCHQ_URL = __BENCHQ_URL__.replace(/\/$/, "");

type Principal = { kind: "firm" | "platform"; role: string; user_id: string; firm_id?: string };
export type Session = { principal: Principal; user?: { id: string; name: string; role: string }; firm?: { name?: string; slug: string } | null };
type StatusTransition = { from: string | null; to: string };
export type Application = {
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
  /** Where BenchQ found the job (`jobs.source`): `jobspy_linkedin`, `linkedin_extension`, `direct`, `manual`… */
  source?: string | null;
  /** The résumé the application was sent with, else the newest one tailored for its job (routes_applications.py). */
  tailored_resume_id?: string | null;
  tailored_resume_name?: string | null;
  tailored_resume_deleted?: boolean;
  has_cover_letter?: boolean;
};

async function send(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${BENCHQ_URL}${path}`, {
    ...init, credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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
function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

export const isSessionExpired = (error: unknown) => error instanceof Error && error.message === "SESSION_EXPIRED";

/** The candidate's Resumes tab on the website: `candidates.detail` in src/lib/routes/registry.ts, tab `resumes`. The
 * website reads the backend's candidate id as it is while candidates run on the backend. */
export const candidateResumesUrl = (firmSlug: string, candidateId: string) =>
  `${BENCHQ_URL}/${encodeURIComponent(firmSlug)}/candidates/${encodeURIComponent(candidateId)}?tab=resumes`;

/** One résumé version in the studio on the website: `resumes.studio` in src/lib/routes/registry.ts, whose URL names
 * the version. */
export const resumeStudioUrl = (firmSlug: string, versionId: string) =>
  `${BENCHQ_URL}/${encodeURIComponent(firmSlug)}/resumes/${encodeURIComponent(versionId)}`;

export const getSession = () => request<Session>("/api/auth/me");
export type Candidate = { id: string; full_name: string };

export const getCandidates = (firmId: string) =>
  request<Candidate[]>(`/api/firms/${encodeURIComponent(firmId)}/candidates`);

/** One version in a candidate's résumé list: its details, never its content (backend/candidates/versions.py). */
export type ResumeVersion = { id: string; version: number; name: string; title: string | null; category: string; job_id: string | null };
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

/** A résumé version's file as it was uploaded, its type and its bytes in base64, held in memory while a tab is reviewed
 * (docs/02 §8.2). Only an uploaded base's first version has one: null for any other. */
export async function getResumeFile(firmId: string, candidateId: string, resumeId: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const response = await send(`${candidatePath(firmId, candidateId)}/resumes/${encodeURIComponent(resumeId)}/file`);
    const mimeType = (response.headers.get("Content-Type") ?? "").split(";")[0]!.trim();
    return { mimeType, data: base64Of(new Uint8Array(await response.arrayBuffer())) };
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

/** Keeps answers the BDE typed on a résumé version's autofill, for next time: phase 3's save route (docs/02 §8.3). */
export const saveResumeAnswers = (firmId: string, candidateId: string, resumeId: string, change: object) =>
  request<unknown>(`${candidatePath(firmId, candidateId)}/resumes/${encodeURIComponent(resumeId)}/autofill`, { method: "PATCH", body: JSON.stringify(change) });

export const getSavedApplications = async (candidateId: string) => {
  const candidate = `&candidate_id=${encodeURIComponent(candidateId)}`;
  const [saved, applied] = await Promise.all([
    request<{ applications: Application[] }>(`/api/applications?status=saved&tracked_only=true&limit=2000${candidate}`),
    request<{ applications: Application[] }>(`/api/applications?status=applied&tracked_only=true&limit=2000${candidate}`),
  ]);
  const savedIds = new Set(saved.applications.map((application) => application.id));
  const appliedFromSaved = applied.applications.filter((application) =>
    !savedIds.has(application.id) && application.status_transitions?.some(
      (transition) => transition.from === "saved" && transition.to === "applied",
    ),
  );
  return [...saved.applications, ...appliedFromSaved];
};
/** Marks the job applied with the form as it stood and, when known, the résumé version its answers came from: the one
 * sent (docs/02 §9). */
/** A job added for a candidate from the page it's on (the add-job plan, 2026-11-11): it becomes one of their jobs and a
 * Saved application at once, or the application they already have for it. */
export const addJob = (candidateId: string, job: PageJob) => request<Application & { job_created: boolean; application_created: boolean }>(
  "/api/applications", {
    method: "POST",
    body: JSON.stringify({
      candidate_id: candidateId,
      job: {
        source: "extension", title: job.title, company: job.company, description: job.description, url: job.url, location: job.location,
        // What the page stated besides; a detail it didn't state is left out (JSON drops undefined).
        work_mode: job.workMode, employment_type: job.employmentType, salary_min: job.salaryMin, salary_max: job.salaryMax,
        salary_currency: job.salaryCurrency, salary_period: job.salaryPeriod, posted_at: job.postedAt, requisition_id: job.requisitionId,
      },
    }),
  });

export const markApplied = (application: Application, form: AppliedForm, resumeId: string | null = null) => request<Application>(`/api/applications/${encodeURIComponent(application.id)}/candidate-status`, {
  method: "PATCH",
  body: JSON.stringify({
    status: "applied", expected_revision: application.status_revision ?? 0, command_id: crypto.randomUUID(), form_data: form,
    ...(resumeId ? { resume_id: resumeId } : {}),
  }),
});
