import type { AppliedForm, AutofillConfig } from "./autofill/types";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BENCHQ_URL}${path}`, {
    ...init, credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw Object.assign(new Error(response.status === 401 ? "SESSION_EXPIRED" : `Request failed (${response.status})`), { status: response.status });
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const isSessionExpired = (error: unknown) => error instanceof Error && error.message === "SESSION_EXPIRED";

/** The candidate's Resumes tab on the website: `candidates.detail` in src/lib/routes/registry.ts, tab `resumes`. The
 * website reads the backend's candidate id as it is while candidates run on the backend. */
export const candidateResumesUrl = (firmSlug: string, candidateId: string) =>
  `${BENCHQ_URL}/${encodeURIComponent(firmSlug)}/candidates/${encodeURIComponent(candidateId)}?tab=resumes`;

export const getSession = () => request<Session>("/api/auth/me");
export type Candidate = { id: string; full_name: string };

export const getCandidates = (firmId: string) =>
  request<Candidate[]>(`/api/firms/${encodeURIComponent(firmId)}/candidates`);

export const getAutofillConfig = (candidateId: string) =>
  request<AutofillConfig>(`/api/autofill/config?candidate_id=${encodeURIComponent(candidateId)}`);

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
export const markApplied = (application: Application, form: AppliedForm) => request<Application>(`/api/applications/${encodeURIComponent(application.id)}/candidate-status`, {
  method: "PATCH",
  body: JSON.stringify({ status: "applied", expected_revision: application.status_revision ?? 0, command_id: crypto.randomUUID(), form_data: form }),
});
