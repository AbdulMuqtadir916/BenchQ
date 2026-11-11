"use client";

import Link from "next/link";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIst } from "@/lib/format/timezone";
import { useJobSearches, useStartJobSearch } from "@/lib/hooks/use-jobs";
import type { Candidate } from "@/lib/schemas/candidate";
import type { JobSearch, JobSearchErrorCode, JobSearches } from "@/lib/schemas/job-search";

/** The words for a failed search's code (backend/job_search/providers/base.py `ERROR_MESSAGES`). */
const FAILED: Record<JobSearchErrorCode, string> = {
  timeout: "The job source didn't answer in time. Try again.",
  provider_unavailable: "The job source is unavailable right now. Try again later.",
  provider_rejected: "The job source refused the search.",
  bad_response: "The job source sent a reply we couldn't read.",
  too_large: "The job source sent too much at once.",
  internal: "Something went wrong running the search. Try again.",
};

/** The role a search asks for: the candidate's main role, else their first target role (docs/02 §6.z). */
export function searchRole(candidate: Pick<Candidate, "primaryRole" | "targetRoles">): string | null {
  return candidate.primaryRole?.trim() || candidate.targetRoles.find((role) => role.trim())?.trim() || null;
}

/** "12 new · 3 seen again · 5 over today's 100", "No new jobs for Java Developer", or why it failed. */
export function searchOutcome(search: JobSearch, jobsCap: number): string {
  if (search.state === "ERROR") return FAILED[search.errorCode ?? "internal"];
  if (search.state === "EMPTY") return `No new jobs for ${search.query ?? "this role"} right now.`;
  const parts = [`${search.newCount} new`];
  if (search.seenAgainCount) parts.push(`${search.seenAgainCount} seen again`);
  if (search.overLimitCount) parts.push(`${search.overLimitCount} over today's ${jobsCap}`);
  return parts.join(" · ");
}

const resetTime = (iso: string) => `${formatIst(iso, "h:mm a")} IST`;

/** "47/100 jobs · 3/20 searches · 2/20 captures · resets 6:30 PM IST": every number the backend's count. */
export function usageLine({ usage }: JobSearches): string {
  return [
    `${usage.jobsToday}/${usage.jobsCap} jobs`,
    usage.searchesToday === null ? null : `${usage.searchesToday}/${usage.searchesCap} searches`,
    usage.capturesToday === null ? null : `${usage.capturesToday}/${usage.capturesCap} captures`,
    `resets ${resetTime(usage.resetsAt)}`,
  ].filter(Boolean).join(" · ");
}

/** Why the button can't start a search now, or null when it can. */
export function blockedReason(candidate: Pick<Candidate, "primaryRole" | "targetRoles" | "country">, searches: JobSearches | undefined): string | null {
  if (!searchRole(candidate)) return "Add a target role first";
  if (!candidate.country?.trim()) return "Add the candidate's country on their résumé";
  const usage = searches?.usage;
  if (usage && usage.searchesToday !== null && usage.searchesToday >= usage.searchesCap) {
    return `${usage.searchesToday}/${usage.searchesCap} searches today · resets ${resetTime(usage.resetsAt)}`;
  }
  return null;
}

interface FindJobsProps {
  candidate: Candidate;
  /** The résumé to open when the country is missing (the header's "Build resume" target). */
  resumeHref: string | null;
  /** Opens the Jobs tab and plays the matching sequence. */
  onFindJobs: () => void;
}

/**
 * "Find jobs" for the candidate's BDE (docs/02 §6.z): starts a real search for the candidate's role, then shows its
 * outcome and today's usage under the button. Disabled, with the reason, when it can't start.
 */
export function FindJobs({ candidate, resumeHref, onFindJobs }: FindJobsProps) {
  const searchesQuery = useJobSearches(candidate.id);
  const start = useStartJobSearch(candidate.id);
  const searches = searchesQuery.data;
  const role = searchRole(candidate);
  const isSearching = Boolean(searches?.running) || start.isPending;
  const blocked = blockedReason(candidate, searches);
  const last = searches?.searches.find((search) => search.kind === "SEARCH") ?? null;
  const refusal = start.error instanceof Error ? start.error.message : null;

  function run() {
    if (!role || blocked || isSearching) return;
    start.mutate(role);
    onFindJobs();
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button variant="secondary" onClick={run} disabled={Boolean(blocked) || isSearching} aria-describedby={`find-jobs-${candidate.id}`}>
        {isSearching ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
        {isSearching ? "Searching…" : "Find jobs"}
      </Button>
      <p id={`find-jobs-${candidate.id}`} className="max-w-xs text-caption text-[var(--color-text-3)] sm:max-w-none sm:text-right" aria-live="polite">
        {blocked ? (
          !candidate.country?.trim() && resumeHref && searchRole(candidate) ? <Link href={resumeHref} className="underline">{blocked}</Link> : blocked
        ) : refusal ? (
          <span className="text-[var(--color-danger-fg)]">{refusal}</span>
        ) : isSearching ? (
          `Searching ${searches?.running?.query ?? role}…`
        ) : last && searches ? (
          searchOutcome(last, searches.usage.jobsCap)
        ) : null}
        {searches && !blocked ? <span className="block sm:whitespace-nowrap">{usageLine(searches)}</span> : null}
      </p>
    </div>
  );
}
