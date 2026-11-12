import { ApiError } from "@/lib/api/client";
import type { TailoringStep } from "@/lib/schemas/tailoring";

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

/** Why a start was refused (the backend's answer), in one sentence; `needsBase` adds a link to the résumés. */
export function startRefusal(error: unknown): { message: string; needsBase: boolean } {
  const status = error instanceof ApiError ? error.status : 0;
  const said = error instanceof Error ? error.message : "";
  if (status === 422) return { message: "This job has no description to tailor to.", needsBase: false };
  if (status === 429) return { message: "You have 5 tailorings running. Wait for one to finish.", needsBase: false };
  if (status === 500) return { message: "Tailoring isn't set up yet. Tell your admin.", needsBase: false };
  if (status === 404) return { message: "This job or résumé isn't this candidate's.", needsBase: false };
  if (status === 409) return { message: said || "This résumé can't be tailored now.", needsBase: /no active base/i.test(said) };
  return { message: "Tailoring didn't start. Try again.", needsBase: false };
}
