"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  CircleHelp,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Heart,
  MapPin,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Job } from "@/lib/schemas/job";
import { matchFor } from "@/lib/derive";
import { useJobPages, useJobSearches } from "@/lib/hooks/use-jobs";
import { NEWEST, dayOptions, readPick } from "@/lib/derive/job-days";
import { SOURCE_FILTER, defaultJobSource, readJobSource, type JobSourceKey } from "@/lib/derive/job-source";
import type { JobSort } from "@/lib/api/jobs";
import { ErrorState } from "@/components/app/error-state";
import { formatRelative } from "@/lib/format/timezone";
import { cn } from "@/lib/cn";
import { EASE_OUT, POPOVER_TRANSITION } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { Tag } from "@/components/ui/tag";
import { MatchScore } from "@/components/app/match-score";
import { VerificationBadge } from "@/components/app/verification-badge";
import { SkeletonList } from "@/components/app/skeleton-list";
import { EmptyState } from "@/components/app/empty-state";
import { PORTALS, PortalLogo, SOURCE_KEYS, openSourceLabel, portalForJob, type PortalKey } from "@/components/app/jobs/portal-logo";
import { canManageResume, useCan } from "@/lib/auth/permissions";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { TailorButton } from "@/components/app/tailoring/tailor-button";
import { useHref } from "@/lib/routes/use-href";
import { useJobMarks, useToggleJobMark } from "@/lib/hooks/use-job-marks";
import { savedJobKey, usePendingSavedJobs, useToggleSavedJob } from "@/lib/hooks/use-applications";
import { ApiError } from "@/lib/api/client";
import { jobLocation } from "@/lib/format/job";
import { SourcePreview } from "@/components/app/jobs/source-preview";

const REMOTE_OPTIONS: SelectOption[] = [
  { value: "ALL", label: "Any work mode" },
  { value: "REMOTE", label: "Remote" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "ONSITE", label: "On-site" },
];

const SOURCE_OPTIONS: Array<SelectOption & { value: JobSourceKey }> = SOURCE_KEYS.map((portal) => ({
  value: portal,
  label: PORTALS[portal].label,
  icon: <PortalLogo portal={portal} size={18} />,
}));

const SORT_PARAM: Record<string, JobSort> = { MATCH: "match", NEWEST: "newest", COMPANY: "company" };

const SCORE_OPTIONS: SelectOption[] = [
  { value: "0", label: "Any score" },
  { value: "70", label: "Score 70+" },
  { value: "85", label: "Score 85+" },
  { value: "95", label: "Score 95+" },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: "MATCH", label: "Top match" },
  { value: "NEWEST", label: "Newest" },
  { value: "COMPANY", label: "Company A–Z" },
];

export function JobExplorer({
  candidates = [],
  applications,
  loading = false,
  lockedCandidate,
  initialCandidateId,
  onCandidateChange,
  animateRows = false,
  showToolbar = true,
  toolbarBordered = true,
  className,
}: {
  candidates?: Candidate[];
  applications: Application[];
  /** The page's own reads (candidates, applications) are loading; the jobs are read here, 100 at a time. */
  loading?: boolean;
  lockedCandidate?: Candidate;
  /** Preselect a candidate context (e.g. arriving from "Find jobs" on a profile). */
  initialCandidateId?: string;
  /** Called when the candidate picked changes, so the page can read that candidate's own jobs (docs/02 §6.z). */
  onCandidateChange?: (candidateId: string) => void;
  /** Stagger the first rows in — used right after the matching intro. */
  animateRows?: boolean;
  showToolbar?: boolean;
  toolbarBordered?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const startingCandidateId = lockedCandidate?.id ?? initialCandidateId ?? "";
  const [candidateId, setCandidateId] = useState(startingCandidateId);
  const [renderedAt] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // One source at a time, each with its count (decided 2026-11-21). A pick lives in the URL; without one the list opens
  // on the first source with jobs for this candidate and Day (`defaultJobSource`).
  const pickedSource = readJobSource(searchParams.get("source"));
  const [openedSource, setOpenedSource] = useState<{ scope: string; source: JobSourceKey } | null>(null);
  // A candidate's jobs open at their newest batch (one Find jobs click, Q109), grouped by Day (2026-11-17, Q166).
  const [batchChoice, setBatchChoice] = useState(NEWEST);
  const [remote, setRemote] = useState("ALL");
  // Every job a candidate has, best Match first (decided 2026-11-14, Q36): no score floor to start with.
  const [scoreFloor, setScoreFloor] = useState("0");
  const [sort, setSort] = useState(startingCandidateId ? "MATCH" : "NEWEST");
  const [selectedId, setSelectedId] = useState("");
  // Hide is the person's own (docs/02 §6.x). Save is for a candidate: the job becomes a Saved application
  // (favourite + Saved draft on the backend) and stays in this list. Only the acting roles get them.
  const canMark = useCan("job.apply");
  const { hiddenIds } = useJobMarks();
  const toggleMark = useToggleJobMark();
  const toggleSavedJob = useToggleSavedJob();
  const pendingSaves = usePendingSavedJobs();
  const [showHidden, setShowHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const context = lockedCandidate ?? candidates.find((candidate) => candidate.id === candidateId) ?? null;
  const contextApplications = useMemo(
    () => (context ? applications.filter((application) => application.candidateId === context.id) : []),
    [applications, context],
  );
  // A Saved job stays in the feed (heart filled); a job that has moved past Saved has left it.
  const appliedIds = useMemo(
    () => new Set(contextApplications.filter((application) => application.status !== "SAVED").map((application) => application.jobId)),
    [contextApplications],
  );
  const savedApplications = useMemo(
    () => new Map(contextApplications.filter((application) => application.status === "SAVED").map((application) => [application.jobId, application.id])),
    [contextApplications],
  );
  const isSaved = (jobId: string) => {
    const pending = context ? pendingSaves.get(savedJobKey(context.id, jobId)) : undefined;
    return pending ?? savedApplications.has(jobId);
  };

  // The candidate's batches by Day (decided 2026-11-17, Q152–Q174, `dayOptions`): the backend numbers them; the
  // empty Days show to the OWNER and MANAGER only (Q167, `team.view`).
  const searchesQuery = useJobSearches(context?.id ?? "", Boolean(context));
  const showEmptyDays = useCan("team.view");
  const days = useMemo(() => (searchesQuery.data
    ? dayOptions(searchesQuery.data.searches, searchesQuery.data.workday, { showEmptyDays })
    : { options: [], newestBatchId: undefined }), [searchesQuery.data, showEmptyDays]);
  const hasBatches = days.newestBatchId !== undefined;
  const pick = context ? readPick(batchChoice, days.newestBatchId) : {};
  const sourceScope = JSON.stringify([context?.id ?? "", pick]);
  const isSourceSettled = pickedSource !== null || openedSource?.scope === sourceScope;
  const portal = pickedSource ?? (openedSource?.scope === sourceScope ? openedSource.source : "FREEHIRE");

  /** The source in the URL; null clears it, so the list opens on its default again. */
  function writeSource(source: JobSourceKey | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (source) next.set("source", source);
    else next.delete("source");
    const search = next.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  function pickSource(value: string) {
    const source = readJobSource(value);
    if (source) writeSource(source);
  }

  function pickDay(value: string) {
    setBatchChoice(value);
    writeSource(null);
  }

  // Every job, 100 at a time, sorted and filtered by the backend over the whole list (decided 2026-11-14, Q28, Q29,
  // Q47): the filters are the request, so "Load more" brings the next part of the same list and the total is real.
  const pages = useJobPages({
    candidateId: context?.id,
    sort: SORT_PARAM[sort === "MATCH" && !context ? "NEWEST" : sort],
    minScore: context ? Number(scoreFloor) : 0,
    source: SOURCE_FILTER[portal],
    remote: remote === "ALL" ? undefined : (remote as "REMOTE" | "HYBRID" | "ONSITE"),
    q: deferredQuery.trim() || undefined,
    excludeApplied: Boolean(context),
    batch: "batch" in pick ? pick.batch : undefined,
    day: "day" in pick ? pick.day : undefined,
  });
  // Each source's count in this list before the source filter (the source tabs, Q109).
  const sourceCounts = pages.data?.pages[0]?.sourceCounts;
  if (!isSourceSettled && sourceCounts && !searchesQuery.isLoading) {
    setOpenedSource({ scope: sourceScope, source: defaultJobSource(sourceCounts) });
  }
  const sourceOptions: SelectOption[] = useMemo(() => SOURCE_OPTIONS.map((option) => {
    if (!sourceCounts) return option;
    return { ...option, label: `${option.label} (${sourceCounts[SOURCE_FILTER[option.value]] ?? 0})` };
  }), [sourceCounts]);
  const total = pages.data?.pages[0]?.total ?? 0;
  const rows = useMemo(() => (pages.data?.pages.flatMap((page) => page.jobs) ?? [])
    // Hidden is the person's own; an application made here since the page loaded leaves at once.
    .filter((job) => (showHidden || !hiddenIds.has(job.id)) && (!context || !appliedIds.has(job.id)))
    .map((job) => {
      const match = matchFor(job, context?.id);
      return { job, score: match?.score ?? null, note: match?.note ?? null, portal: portalForJob(job) };
    }), [pages.data, hiddenIds, showHidden, context, appliedIds]);
  const isListLoading = loading || pages.isLoading || (!isSourceSettled && !pages.error);

  const selected = rows.find(({ job }) => job.id === selectedId) ?? rows[0] ?? null;
  const arrivedToday = rows.filter(({ job }) => job.postedAt && renderedAt - new Date(job.postedAt).getTime() < 86_400_000).length;
  // A save error belongs to the candidate it was for: another candidate in context never shows it.
  const failedFor = toggleSavedJob.variables && ("save" in toggleSavedJob.variables ? toggleSavedJob.variables.save.candidateId : toggleSavedJob.variables.unsave.candidateId);
  const saveError = toggleSavedJob.error && failedFor === context?.id
    ? toggleSavedJob.error instanceof ApiError && toggleSavedJob.error.status === 404
      ? `This job is not in ${context?.fullName ?? "this candidate"}'s job list, so it can't be saved for them yet.`
      : toggleSavedJob.error.message
    : null;
  const activeFilterCount = [remote !== "ALL", Number(scoreFloor) > 0, Boolean(query)].filter(Boolean).length;

  /** Heart: save the job for the candidate in context, or remove the untouched Saved draft again. */
  function toggleSaved(job: Job) {
    if (!context || pendingSaves.has(savedJobKey(context.id, job.id))) return;
    const applicationId = savedApplications.get(job.id);
    if (applicationId) toggleSavedJob.mutate({ unsave: { applicationId, jobId: job.id, candidateId: context.id } });
    else saveJob(job);
  }

  function saveJob(job: Job) {
    if (!context || savedApplications.has(job.id) || pendingSaves.has(savedJobKey(context.id, job.id))) return;
    toggleSavedJob.mutate({
      save: { candidateId: context.id, jobId: job.id, title: job.title, company: job.company.name, url: job.applyUrl ?? job.provenance.sourceUrl ?? "" },
    });
  }

  /** Opening a job's source means the BDE is working on it: it is saved for the candidate in context. */
  const onOpenSource = canMark && context ? (job: Job) => saveJob(job) : null;

  /** Hide a job from your own feed, or bring it back while hidden jobs are shown. */
  function toggleHidden(id: string) {
    toggleMark.mutate({ jobId: id, kind: "HIDDEN", on: !hiddenIds.has(id) });
    setMenuOpen(false);
  }

  async function copyJobLink(job: Job) {
    const value = job.provenance.sourceUrl ?? job.applyUrl ?? window.location.href;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const candidateOptions: SelectOption[] = [
    { value: "", label: "Browse for any candidate", icon: <BriefcaseBusiness size={14} /> },
    ...candidates.map((candidate) => ({
      value: candidate.id,
      label: candidate.fullName,
      description: `${candidate.primaryRole ?? "Open role"} · ${candidate.workAuth}`,
    })),
  ];

  return (
    <section className={cn("space-y-3", className)} aria-label={lockedCandidate ? `Jobs matched to ${lockedCandidate.fullName}` : "Job explorer"}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-body-strong text-[var(--color-text)]">
            {lockedCandidate ? "Profile-matched roles" : `${total} open roles`}
            {activeFilterCount ? <Tag tone="blue">{activeFilterCount} filters</Tag> : null}
          </div>
          <p className="mt-0.5 text-caption text-[var(--color-text-3)]">
            {arrivedToday} arrived today · {context ? `Match for ${context.fullName}` : "select a candidate to see their Match"}
          </p>
        </div>
        <Select value={sort} options={SORT_OPTIONS} onValueChange={setSort} aria-label="Sort jobs" className="w-36" />
      </div>

      {showToolbar ? (
        <div className={cn(
          toolbarBordered && "rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-xs)]",
        )}>
          <div className={cn(
            "grid gap-2 md:grid-cols-2",
            lockedCandidate
              ? "xl:grid-cols-[minmax(260px,440px)_170px_150px_140px]"
              : "xl:grid-cols-[minmax(210px,1.4fr)_170px_150px_140px_120px]",
          )}>
            <label className="relative block">
              <span className="sr-only">Search jobs</span>
              <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-[var(--color-text-3)]" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, company, location…" className="pl-8" />
            </label>
            {!lockedCandidate ? <Select value={candidateId} options={candidateOptions} onValueChange={(value) => { setCandidateId(value); onCandidateChange?.(value); setSelectedId(""); setScoreFloor("0"); setSort(value ? "MATCH" : "NEWEST"); writeSource(null); }} aria-label="Candidate context" /> : <Select value={portal} options={sourceOptions} onValueChange={pickSource} aria-label="Job source" />}
            {!lockedCandidate ? <Select value={portal} options={sourceOptions} onValueChange={pickSource} aria-label="Job source" /> : null}
            {context && hasBatches ? <Select value={batchChoice} options={days.options} onValueChange={pickDay} aria-label="Day and batch" /> : null}
            <Select value={remote} options={REMOTE_OPTIONS} onValueChange={setRemote} aria-label="Work mode" />
            <Select value={scoreFloor} options={SCORE_OPTIONS} onValueChange={setScoreFloor} aria-label="Minimum match score" disabled={!context} />
          </div>
        </div>
      ) : null}

      {saveError ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{saveError}</p> : null}

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-xs)] lg:grid lg:h-[calc(100dvh-260px)] lg:min-h-[510px] lg:grid-cols-[minmax(350px,42%)_minmax(0,1fr)]">
        <div className="min-h-[360px] border-b border-[var(--color-border)] lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex h-9 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-caption text-[var(--color-text-3)]">
            <span className="flex items-center gap-2">
              <span className="tabular">{rows.length} of {total} shown</span>
              {canMark && hiddenIds.size > 0 ? (
                <button type="button" aria-pressed={showHidden} onClick={() => setShowHidden((value) => !value)} className="rounded-[var(--radius-sm)] text-[var(--color-primary-subtle-fg)] hover:underline">
                  {showHidden ? `Hide ${hiddenIds.size} hidden` : `Show ${hiddenIds.size} hidden`}
                </button>
              ) : null}
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-[10px]"><span aria-hidden>↑↓</span> move · Enter open <CircleHelp size={13} aria-hidden /></span>
          </div>
          <div className="h-[520px] overflow-y-auto lg:h-[calc(100%-36px)]">
            {isListLoading ? (
              <SkeletonList rows={8} />
            ) : pages.error ? (
              <div className="p-4"><ErrorState error={pages.error} onRetry={() => void pages.refetch()} /></div>
            ) : rows.length === 0 ? (
              <div className="p-4"><EmptyState icon={Search} title="No matching jobs" description="Try a wider search or lower the score filter." variant="filtered" /></div>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {rows.map((row, index) => {
                  const { job, score, note, portal: rowPortal } = row;
                  const isSelected = selected?.job.id === job.id;
                  const isStaggered = animateRows && !reduceMotion && index < 12;
                  return (
                    <motion.li
                      key={job.id}
                      initial={isStaggered ? { opacity: 0, y: 10 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, delay: isStaggered ? index * 0.045 : 0, ease: EASE_OUT }}
                      className={cn("group grid transition-colors", canMark ? "grid-cols-[minmax(0,1fr)_32px]" : "grid-cols-1", hiddenIds.has(job.id) && "opacity-60", isSelected ? "bg-[var(--color-primary-subtle)]" : "hover:bg-[var(--color-surface-2)]")}
                      style={{ contentVisibility: "auto", containIntrinsicSize: "74px" }}
                    >
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => { setSelectedId(job.id); setMenuOpen(false); }}
                        className="flex min-w-0 gap-3 px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
                      >
                          <PortalLogo portal={rowPortal} domain={job.company.domain} size={28} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <h3 className="truncate text-body-strong text-[var(--color-text)]">{job.title}</h3>
                              {score !== null ? <MatchScore score={score} note={note} variant="ring" /> : null}
                            </div>
                            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-[var(--color-text-2)]">
                              <span className="truncate">{job.company.name}</span><span className="text-[var(--color-border-strong)]">·</span><span className="truncate">{jobLocation(job)}</span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption text-[var(--color-text-3)]">
                              <span className="inline-flex items-center gap-1"><PortalLogo portal={rowPortal} domain={job.company.domain} size={16} />{PORTALS[rowPortal].label}</span>
                              {job.rateMax ? <span className="font-mono">${job.rateMin}–{job.rateMax}/hr</span> : null}
                              {job.postedAt ? <span>{formatRelative(job.postedAt)}</span> : null}
                              {job.excludesC2C ? <Tag tone="amber">No C2C</Tag> : null}
                            </div>
                          </div>
                      </button>
                      {canMark ? (
                        <div className="flex flex-col border-l border-[var(--color-border)]">
                          <button
                            type="button"
                            aria-label={!context ? "Choose a candidate to save this job" : isSaved(job.id) ? `Remove from ${context.fullName}'s Saved` : `Save for ${context.fullName}`}
                            title={!context ? "Choose a candidate to save this job" : undefined}
                            aria-pressed={isSaved(job.id)}
                            disabled={!context}
                            onClick={() => toggleSaved(job)}
                            className={cn("flex flex-1 items-center justify-center text-[var(--color-text-3)] hover:bg-[var(--color-surface)] hover:text-[var(--color-danger-fg)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-[var(--color-text-3)]", isSaved(job.id) && "text-[var(--color-danger-fg)]")}
                          >
                            <Heart size={14} fill={isSaved(job.id) ? "currentColor" : "none"} />
                          </button>
                          <button type="button" aria-label={hiddenIds.has(job.id) ? "Unhide job" : "Hide job"} onClick={() => toggleHidden(job.id)} className="flex flex-1 items-center justify-center border-t border-[var(--color-border)] text-[var(--color-text-3)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]">
                            {hiddenIds.has(job.id) ? <Eye size={14} /> : <EyeOff size={14} />}
                          </button>
                        </div>
                      ) : null}
                    </motion.li>
                  );
                })}
                {pages.hasNextPage ? (
                  <li className="p-3">
                    <Button variant="secondary" size="sm" className="w-full" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
                      {pages.isFetchingNextPage ? "Loading…" : `Load more (${Math.max(0, total - (pages.data?.pages.reduce((sum, page) => sum + page.jobs.length, 0) ?? 0))} more)`}
                    </Button>
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </div>

        {/* The pane keeps the panel's height and scrolls as one (the job's header, then its whole posting), so a short
            window shows the description by scrolling, never cut off. */}
        <div className="min-w-0 bg-[var(--color-surface)] lg:min-h-0 lg:overflow-y-auto">
          {selected ? (
            <motion.div key={selected.job.id} initial={{ opacity: 0, x: reduceMotion ? 0 : 5 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reduceMotion ? 0.1 : 0.2 }} className="flex min-h-[580px] flex-col lg:min-h-full">
              <JobDetailHeader
                job={selected.job}
                score={selected.score}
                note={selected.note}
                portal={selected.portal}
                context={context}
                menuOpen={menuOpen}
                copied={copied}
                onMenuToggle={() => setMenuOpen((open) => !open)}
                onCopy={() => copyJobLink(selected.job)}
                isHidden={hiddenIds.has(selected.job.id)}
                onHide={canMark ? () => toggleHidden(selected.job.id) : null}
                onOpenSource={onOpenSource}
              />
              <SourcePreview job={selected.job} portal={selected.portal} onOpenSource={onOpenSource} />
            </motion.div>
          ) : (
            <div className="flex h-full min-h-[520px] items-center justify-center p-8 text-center">
              <div>
                <BriefcaseBusiness size={28} className="mx-auto text-[var(--color-text-3)]" />
                <h3 className="mt-3 text-h3 text-[var(--color-text)]">Choose a job</h3>
                <p className="mt-1 text-sm text-[var(--color-text-3)]">Select a role to inspect its source and requirements.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function JobDetailHeader({
  job,
  score,
  note,
  portal,
  context,
  menuOpen,
  copied,
  onMenuToggle,
  onCopy,
  isHidden,
  onHide,
  onOpenSource,
}: {
  job: Job;
  score: number | null;
  /** Why the score is held at 40, shown on hover (Q37). */
  note: string | null;
  portal: PortalKey;
  context: Candidate | null;
  menuOpen: boolean;
  copied: boolean;
  onMenuToggle: () => void;
  onCopy: () => void;
  isHidden: boolean;
  /** Null for a read-only viewer: no Hide in the menu. */
  onHide: (() => void) | null;
  /** Saves the job for the candidate in context when its source is opened; null when nothing is saved. */
  onOpenSource: ((job: Job) => void) | null;
}) {
  const toHref = useHref();
  // Only the candidate's BDE tailors (07 Q55); everyone else gets the job's details.
  const principal = useSignedInPrincipal();
  const canTailor = context ? canManageResume(principal, context) : false;
  const sourceUrl = job.provenance.sourceUrl ?? job.applyUrl ?? toHref("jobs.detail", { id: job.id }, { candidate: context?.id });
  return (
    <div className="relative border-b border-[var(--color-border)]">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-mono-sm uppercase tracking-[0.12em] text-[var(--color-text-3)]">
            <PortalLogo portal={portal} domain={job.company.domain} size={20} />
            <span>{job.company.name}</span><span>·</span><span>{PORTALS[portal].label}</span>{job.postedAt ? <><span>·</span><span>{formatRelative(job.postedAt)}</span></> : null}
          </div>
          <h2 className="max-w-3xl text-h1 text-[var(--color-text)]">{job.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-2)]">
            <span className="inline-flex items-center gap-1"><MapPin size={13} />{jobLocation(job)}</span>
            <span>·</span><span>{job.employmentType ?? "Contract"}</span>
            {job.rateMax ? <><span>·</span><span className="font-mono">${job.rateMin}–{job.rateMax}/hr</span></> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="secondary" size="sm"><a href={sourceUrl} target="_blank" rel="noreferrer" onClick={() => onOpenSource?.(job)}>{openSourceLabel(portalForJob(job))}<ExternalLink size={13} /></a></Button>
          {context && canTailor ? <TailorButton candidate={context} job={job} /> : <Button asChild size="sm"><Link href={toHref("jobs.detail", { id: job.id }, { candidate: context?.id })}>View details<ArrowUpRight size={13} /></Link></Button>}
          <Button variant="secondary" size="icon" aria-label="More job actions" aria-expanded={menuOpen} onClick={onMenuToggle}><MoreHorizontal size={15} /></Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-2.5">
        <div className="flex items-center gap-3">
          {score !== null ? <><MatchScore score={score} note={note} /><span className="text-sm text-[var(--color-text-2)]">Match for {context?.fullName}</span></> : <span className="text-sm text-[var(--color-text-3)]">{context ? "The Match isn't worked out yet." : "Select a candidate to see their Match."}</span>}
        </div>
        <div className="flex items-center gap-2"><VerificationBadge verification={job.company.verification} />{job.company.h1b?.sponsorsH1b ? <Tag tone="green">H-1B sponsor</Tag> : null}</div>
      </div>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -3, scale: 0.985 }} transition={POPOVER_TRANSITION} className="absolute right-5 top-16 z-30 w-56 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-md)]">
            <button type="button" onClick={onCopy} className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-sm text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Link copied" : "Copy job link"}</button>
            <a href={sourceUrl} target="_blank" rel="noreferrer" onClick={() => onOpenSource?.(job)} className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-sm text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"><ExternalLink size={14} />Open in new tab</a>
            {onHide ? (
              <button type="button" onClick={onHide} className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-sm text-[var(--color-danger-fg)] hover:bg-[var(--color-danger-bg)]">{isHidden ? <><Eye size={14} />Unhide this job</> : <><EyeOff size={14} />Hide this job</>}</button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
