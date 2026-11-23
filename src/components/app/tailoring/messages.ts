import { ApiError } from "@/lib/api/client";
import { describeError, isSystemError, type ErrorText } from "@/lib/api/error-text";
import type { TailoringRun, TailoringStep } from "@/lib/schemas/tailoring";

/** What each step is called while it runs (part 3 R2-Q1: the run's real step, never a guess). */
export const STEP_LABELS: Record<TailoringStep, string> = {
  analyse: "Reading the job",
  draft: "Writing the draft",
  review: "Reviewing the draft",
  revise: "Revising",
  verify: "Checking against the résumé",
  save: "Saving the version",
};

/** Why a run failed, in one sentence, and whether Try again can help (decided 2026-11-12, part 3 Q8). */
export function runFailure(code: string | null): { message: string; canRetry: boolean } {
  switch (code) {
    case "gone":
      return { message: "The résumé or the job was removed.", canRetry: false };
    case "hidden":
      return { message: "The base made from this version is hidden. Show it again, then tailor.", canRetry: false };
    case "setup":
      return { message: "Tailoring isn't set up yet. Tell your admin.", canRetry: false };
    default: // provider_failed, unreadable_reply, lost, internal
      return { message: "Tailoring failed.", canRetry: true };
  }
}

const DIDNT_START = "Tailoring didn't start. Try again.";

/**
 * The tailor's own words for a refused start, by the body's code (docs/02 §12.1), never by status: the codes the start
 * sends (backend/resume_tailor/runs.py, backend/api/routes_resume_tailoring.py). Reached only for a non-system error
 * (the throttle, busy, a crash read as everywhere else). Any other refusal keeps the backend's own sentence: "This job
 * has no description to tailor the résumé to." (its 422), "This résumé is already being tailored for this job." (a
 * 409), and so on. An error that isn't the backend's at all (a bug) says the start didn't happen.
 */
function refusalText(error: unknown): string | null {
  if (!(error instanceof ApiError)) return DIDNT_START;
  switch (error.backendCode) {
    case "TAILORINGS_RUNNING":
      return "You have 5 tailorings running. Wait for one to finish.";
    case "NOT_CONFIGURED":
      return "Tailoring isn't set up yet. Tell your admin.";
    case "NOT_FOUND": // the backend's is a bare "Not found." (no 404 names what is missing: docs/02 §12.2, rule 1)
      return "This job or résumé isn't this candidate's.";
    default:
      return null;
  }
}

/** Why a start was refused, in one sentence (src/lib/api/error-text.ts picks it); `needsBase` adds a link to the
 * résumés. */
export function startRefusal(error: unknown): ErrorText & { needsBase: boolean } {
  const text = describeError(error, { screenText: refusalText, fallback: DIDNT_START });
  const isNoBase = !isSystemError(error) && error instanceof ApiError && error.status === 409 && /no active base/i.test(error.message);
  return { ...text, needsBase: isNoBase };
}

/** Of the tailorings a Focus run started: how many saved a résumé, and how many still run (Abdul's review, 2026-11-12:
 * "Tailored" counted starts, which may still fail). */
export function startedOutcomes(runs: readonly TailoringRun[], started: readonly string[]): { tailored: number; running: number } {
  const mine = runs.filter((run) => started.includes(run.runId));
  return { tailored: mine.filter((run) => run.status === "completed").length, running: mine.filter((run) => run.status === "running").length };
}
