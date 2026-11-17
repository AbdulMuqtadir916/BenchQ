"use client";

import Link from "next/link";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { formatIst } from "@/lib/format/timezone";
import { useJobSearches } from "@/lib/hooks/use-jobs";
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

/** The role a search asks for: the candidate's target role, the first one (decided 2026-11-14; the backend's
 * `places.search_role`). The primary role isn't searched. */
export function searchRole(candidate: Pick<Candidate, "targetRoles">): string | null {
  return candidate.targetRoles.map((role) => role.trim().replace(/\s+/g, " ")).find(Boolean) ?? null;
}

/** How a search's place reads: "Austin, TX" or "Remote", never its mode (a hybrid search's "hybrid:Austin, TX" too), or
 * nothing for a search from before places. */
export function placeLabel(place: string | null): string | null {
  if (place === "remote") return "Remote";
  return place?.startsWith("hybrid:") ? place.slice("hybrid:".length) : place;
}

/** The sources' names as the result line says them (backend source names). */
const SOURCE_NAMES: Record<string, string> = { linkedin: "LinkedIn", indeed: "Indeed", freehire: "freehire.me" };

/** "12 new · 3 seen again · 5 over today's 100 · 4 left out: work authorization", "No new jobs for Java Developer in
 * Austin, TX", or why it failed. */
/**
 * What the BDE needs to know about the last search: only what they can act on (Zuhair 2026-11-17: the per-source
 * counts, "seen again", "over today's 200" and the left-out counts cluttered the header and are no longer shown). A
 * failed search says why; a source that didn't answer is named. Otherwise nothing: the usage line says the rest.
 */
export function searchOutcome(search: JobSearch): string | null {
  if (search.state === "ERROR") return FAILED[search.errorCode ?? "internal"];
  if (search.failedSources.length) return `${search.failedSources.map((name) => SOURCE_NAMES[name] ?? name).join(", ")} didn't answer: try again`;
  return null;
}

/** When the firm's work day resets, in its own time zone: "6:30 PM IST" (decided 2026-11-17, Q157). */
export function resetTime(iso: string, timeZone = "Asia/Kolkata"): string {
  if (timeZone === "Asia/Kolkata") return `${formatIst(iso, "h:mm a")} IST`;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(new Date(iso));
}

/** "47/200 jobs · 3/20 searches · 2/20 added manually · resets 6:30 PM IST": every number the backend's count, for
 * the firm's current work day. "Added manually" is a job the BDE added through Add job or the extension (a capture). */
export function usageLine({ usage, workday }: JobSearches): string {
  return [
    `${usage.jobsToday}/${usage.jobsCap} jobs`,
    usage.searchesToday === null ? null : `${usage.searchesToday}/${usage.searchesCap} searches`,
    usage.capturesToday === null ? null : `${usage.capturesToday}/${usage.capturesCap} added manually`,
    `resets ${resetTime(usage.resetsAt, workday.timezone)}`,
  ].filter(Boolean).join(" · ");
}

/** Why the button can't start a search now, or null when it can. */
export function blockedReason(candidate: Pick<Candidate, "targetRoles" | "country">, searches: JobSearches | undefined): string | null {
  if (!searchRole(candidate)) return "Add a target role first";
  if (!candidate.country?.trim()) return "Add the candidate's country on their résumé";
  // A search needs a place (decided 2026-11-14): the résumé's city and state, or a preferred location.
  if (searches && searches.places.length === 0) return "Add a city and state on the résumé, or a preferred location";
  const usage = searches?.usage;
  if (usage && usage.searchesToday !== null && usage.searchesToday >= usage.searchesCap) {
    return `${usage.searchesToday}/${usage.searchesCap} searches today · resets ${resetTime(usage.resetsAt, searches?.workday.timezone)}`;
  }
  // The backend refuses a search once the candidate has today's new jobs (429): say so before the press.
  if (usage && usage.jobsToday >= usage.jobsCap) return `${usage.jobsToday}/${usage.jobsCap} new jobs today · resets ${resetTime(usage.resetsAt, searches?.workday.timezone)}`;
  return null;
}

/** The search, owned by the candidate page: every "Find jobs" there starts the same one and shares its refusal. */
export interface FindJobsSearch {
  /** Starts the search for the candidate's role in `place`, opens the Jobs tab and plays the matching sequence. */
  run: () => void;
  /** The place the next search uses (one of `JobSearches.places`), or null while none is known. */
  place: string | null;
  setPlace: (value: string) => void;
  isStarting: boolean;
  /** Why the backend refused the last start (409, 422, 429, 503), as it says it. */
  refusal: string | null;
}

interface FindJobsProps {
  candidate: Candidate;
  /** The résumé to open when the country or a place is missing (the header's "Build resume" target). */
  resumeHref: string | null;
  search: FindJobsSearch;
}

/**
 * "Find jobs" for the candidate's BDE (docs/02 §6.z): starts a real search for the candidate's target role in the place
 * picked beside it, asking every source that place's mode names in one click (decided 2026-11-17, Q90, Q122), then
 * shows its outcome by source and today's usage under the button. Disabled, with the reason, when it
 * can't start.
 */
export function FindJobs({ candidate, resumeHref, search }: FindJobsProps) {
  const searchesQuery = useJobSearches(candidate.id);
  const searches = searchesQuery.data;
  const role = searchRole(candidate);
  const isSearching = Boolean(searches?.running) || search.isStarting;
  const blocked = blockedReason(candidate, searches);
  const last = searches?.searches.find((search) => search.kind === "SEARCH") ?? null;
  const refusal = search.refusal;
  // Today's searches didn't load: whether one runs, and the day's usage, are unknown, so no start (CodeRabbit on #135).
  const isUnknown = !searches && Boolean(searchesQuery.error);
  const places = searches?.places ?? [];
  // The résumé fixes a missing country, city or state; a preferred location can't be edited here yet.
  const linksToResume = Boolean(resumeHref && role && (!candidate.country?.trim() || (searches && places.length === 0)));
  const running = searches?.running ?? null;

  function run() {
    if (!role || blocked || isSearching || isUnknown) return;
    search.run();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {places.length ? (
          <Select value={search.place ?? places[0].value} options={places.map((p) => ({ value: p.value, label: p.label }))}
            onValueChange={search.setPlace} disabled={isSearching} aria-label="Where to search" className="w-auto min-w-40" />
        ) : null}
        <Button variant="secondary" onClick={run} disabled={Boolean(blocked) || isSearching || isUnknown} aria-describedby={`find-jobs-${candidate.id}`}>
          {isSearching ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
          {isSearching ? "Searching…" : "Find jobs"}
        </Button>
      </div>
      {/* Capped and wrapping: a click's line names every source and every reason a job was left out (2026-11-17), and
          at full length it squeezed the candidate's name into a narrow column beside it. */}
      <p id={`find-jobs-${candidate.id}`} className="max-w-xs text-right text-caption text-[var(--color-text-3)] sm:max-w-sm md:max-w-md" aria-live="polite">
        {isUnknown ? (
          <span className="inline-flex items-center gap-2">Today&apos;s searches didn&apos;t load.<button type="button" onClick={() => void searchesQuery.refetch()} className="underline">Retry</button></span>
        ) : blocked ? (
          linksToResume && resumeHref ? <Link href={resumeHref} className="underline">{blocked}</Link> : blocked
        ) : refusal ? (
          <span className="text-[var(--color-danger-fg)]">{refusal}</span>
        ) : isSearching ? (
          `Searching ${running?.query ?? role}${placeLabel(running?.place ?? search.place) ? ` in ${placeLabel(running?.place ?? search.place)}` : ""}…`
        ) : last ? (
          searchOutcome(last)
        ) : null}
        {searches && !blocked ? <span className="block">{usageLine(searches)}</span> : null}
      </p>
    </div>
  );
}
