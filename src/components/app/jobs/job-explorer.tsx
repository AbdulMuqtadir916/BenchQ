"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  CircleHelp,
  Clock3,
  Copy,
  ExternalLink,
  EyeOff,
  Heart,
  MapPin,
  MoreHorizontal,
  Search,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Job } from "@/lib/schemas/job";
import { deriveMatchScore } from "@/lib/derive";
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
import { PORTALS, PortalLogo, portalForJob, type PortalKey } from "@/components/app/jobs/portal-logo";
import { useHref } from "@/lib/routes/use-href";

const REMOTE_OPTIONS: SelectOption[] = [
  { value: "ALL", label: "Any work mode" },
  { value: "REMOTE", label: "Remote" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "ONSITE", label: "On-site" },
];

const SOURCE_OPTIONS: SelectOption[] = [
  { value: "ALL", label: "All sources" },
  ...(["LINKEDIN", "INDEED", "DICE", "GLASSDOOR", "COMPANY"] as const).map((portal) => ({
    value: portal,
    label: PORTALS[portal].label,
    icon: <PortalLogo portal={portal} size={18} />,
  })),
];

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
  jobs,
  candidates = [],
  applications,
  loading = false,
  lockedCandidate,
  initialCandidateId,
  animateRows = false,
  showToolbar = true,
  toolbarBordered = true,
  className,
}: {
  jobs: Job[];
  candidates?: Candidate[];
  applications: Application[];
  loading?: boolean;
  lockedCandidate?: Candidate;
  /** Preselect a candidate context (e.g. arriving from "Find jobs" on a profile). */
  initialCandidateId?: string;
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
  const [portal, setPortal] = useState("ALL");
  const [remote, setRemote] = useState("ALL");
  const [scoreFloor, setScoreFloor] = useState(startingCandidateId ? "70" : "0");
  const [sort, setSort] = useState(startingCandidateId ? "MATCH" : "NEWEST");
  const [selectedId, setSelectedId] = useState("");
  const [savedIds, setSavedIds] = useState(() => new Set<string>());
  const [hiddenIds, setHiddenIds] = useState(() => new Set<string>());
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const context = lockedCandidate ?? candidates.find((candidate) => candidate.id === candidateId) ?? null;
  const appliedIds = useMemo(
    () => new Set(context ? applications.filter((application) => application.candidateId === context.id).map((application) => application.jobId) : []),
    [applications, context],
  );

  const rows = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    const minimum = Number(scoreFloor);
    const list = jobs
      .filter((job) => job.isActive && job.dedupe.duplicateOfJobId === null && !hiddenIds.has(job.id))
      .filter((job) => !context || (job.allowedWorkAuth.includes(context.workAuth) && !appliedIds.has(job.id)))
      .map((job) => ({ job, score: context ? deriveMatchScore(context, job) : null, portal: portalForJob(job) }))
      .filter(({ job, score, portal: rowPortal }) => {
        if (normalizedQuery && !`${job.title} ${job.company.name} ${job.city ?? ""} ${job.state ?? ""}`.toLowerCase().includes(normalizedQuery)) return false;
        if (portal !== "ALL" && rowPortal !== portal) return false;
        if (remote !== "ALL" && job.remoteMode !== remote) return false;
        if (context && score !== null && score < minimum) return false;
        return true;
      });

    list.sort((a, b) => {
      if (sort === "MATCH" && a.score !== null && b.score !== null && a.score !== b.score) return b.score - a.score;
      if (sort === "COMPANY") return a.job.company.name.localeCompare(b.job.company.name);
      return (b.job.postedAt ?? "").localeCompare(a.job.postedAt ?? "");
    });
    return list.slice(0, lockedCandidate ? 40 : 80);
  }, [jobs, hiddenIds, context, appliedIds, deferredQuery, portal, remote, scoreFloor, sort, lockedCandidate]);

  const selected = rows.find(({ job }) => job.id === selectedId) ?? rows[0] ?? null;
  const arrivedToday = rows.filter(({ job }) => job.postedAt && renderedAt - new Date(job.postedAt).getTime() < 86_400_000).length;
  const activeFilterCount = [portal !== "ALL", remote !== "ALL", Number(scoreFloor) > 0, Boolean(query)].filter(Boolean).length;

  function toggleSaved(id: string) {
    setSavedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function hideSelected(id: string) {
    setHiddenIds((current) => new Set(current).add(id));
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
            {lockedCandidate ? "Profile-matched roles" : `${rows.length} open roles`}
            {activeFilterCount ? <Tag tone="blue">{activeFilterCount} filters</Tag> : null}
          </div>
          <p className="mt-0.5 text-caption text-[var(--color-text-3)]">
            {arrivedToday} arrived today · {context ? `scored for ${context.fullName}` : "select a candidate to score matches"}
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
            {!lockedCandidate ? <Select value={candidateId} options={candidateOptions} onValueChange={(value) => { setCandidateId(value); setSelectedId(""); setScoreFloor(value ? "70" : "0"); setSort(value ? "MATCH" : "NEWEST"); }} aria-label="Candidate context" /> : <Select value={portal} options={SOURCE_OPTIONS} onValueChange={setPortal} aria-label="Job source" />}
            {!lockedCandidate ? <Select value={portal} options={SOURCE_OPTIONS} onValueChange={setPortal} aria-label="Job source" /> : null}
            <Select value={remote} options={REMOTE_OPTIONS} onValueChange={setRemote} aria-label="Work mode" />
            <Select value={scoreFloor} options={SCORE_OPTIONS} onValueChange={setScoreFloor} aria-label="Minimum match score" disabled={!context} />
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-xs)] lg:grid lg:h-[calc(100dvh-260px)] lg:min-h-[510px] lg:grid-cols-[minmax(350px,42%)_minmax(0,1fr)]">
        <div className="min-h-[360px] border-b border-[var(--color-border)] lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex h-9 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-caption text-[var(--color-text-3)]">
            <span className="tabular">{rows.length} shown</span>
            <span className="inline-flex items-center gap-1 font-mono text-[10px]"><span aria-hidden>↑↓</span> move · Enter open <CircleHelp size={13} aria-hidden /></span>
          </div>
          <div className="h-[520px] overflow-y-auto lg:h-[calc(100%-36px)]">
            {loading ? (
              <SkeletonList rows={8} />
            ) : rows.length === 0 ? (
              <div className="p-4"><EmptyState icon={Search} title="No matching jobs" description="Try a wider search or lower the score filter." variant="filtered" /></div>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {rows.map((row, index) => {
                  const { job, score, portal: rowPortal } = row;
                  const isSelected = selected?.job.id === job.id;
                  const isStaggered = animateRows && !reduceMotion && index < 12;
                  return (
                    <motion.li
                      key={job.id}
                      initial={isStaggered ? { opacity: 0, y: 10 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, delay: isStaggered ? index * 0.045 : 0, ease: EASE_OUT }}
                      className={cn("group grid grid-cols-[minmax(0,1fr)_32px] transition-colors", isSelected ? "bg-[var(--color-primary-subtle)]" : "hover:bg-[var(--color-surface-2)]")}
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
                              {score !== null ? <MatchScore score={score} variant="ring" /> : null}
                            </div>
                            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-[var(--color-text-2)]">
                              <span className="truncate">{job.company.name}</span><span className="text-[var(--color-border-strong)]">·</span><span className="truncate">{job.remoteMode === "REMOTE" ? "Remote" : `${job.city}, ${job.state}`}</span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption text-[var(--color-text-3)]">
                              <span className="inline-flex items-center gap-1"><PortalLogo portal={rowPortal} domain={job.company.domain} size={16} />{PORTALS[rowPortal].label}</span>
                              {job.rateMax ? <span className="font-mono">${job.rateMin}–{job.rateMax}/hr</span> : null}
                              {job.postedAt ? <span>{formatRelative(job.postedAt)}</span> : null}
                              {job.excludesC2C ? <Tag tone="amber">No C2C</Tag> : null}
                            </div>
                          </div>
                      </button>
                      <div className="flex flex-col border-l border-[var(--color-border)]">
                          <button type="button" aria-label={savedIds.has(job.id) ? "Unsave job" : "Save job"} onClick={() => toggleSaved(job.id)} className="flex flex-1 items-center justify-center text-[var(--color-text-3)] hover:bg-[var(--color-surface)] hover:text-[var(--color-danger-fg)]">
                            <Heart size={14} fill={savedIds.has(job.id) ? "currentColor" : "none"} />
                          </button>
                          <button type="button" aria-label="Hide job" onClick={() => hideSelected(job.id)} className="flex flex-1 items-center justify-center border-t border-[var(--color-border)] text-[var(--color-text-3)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]">
                            <EyeOff size={14} />
                          </button>
                      </div>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="min-w-0 bg-[var(--color-surface)]">
          {selected ? (
            <motion.div key={selected.job.id} initial={{ opacity: 0, x: reduceMotion ? 0 : 5 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reduceMotion ? 0.1 : 0.2 }} className="flex h-full min-h-[580px] flex-col lg:min-h-0">
              <JobDetailHeader
                job={selected.job}
                score={selected.score}
                portal={selected.portal}
                context={context}
                menuOpen={menuOpen}
                copied={copied}
                onMenuToggle={() => setMenuOpen((open) => !open)}
                onCopy={() => copyJobLink(selected.job)}
                onHide={() => hideSelected(selected.job.id)}
              />
              <SourcePreview job={selected.job} portal={selected.portal} />
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
  portal,
  context,
  menuOpen,
  copied,
  onMenuToggle,
  onCopy,
  onHide,
}: {
  job: Job;
  score: number | null;
  portal: PortalKey;
  context: Candidate | null;
  menuOpen: boolean;
  copied: boolean;
  onMenuToggle: () => void;
  onCopy: () => void;
  onHide: () => void;
}) {
  const toHref = useHref();
  const sourceUrl = job.provenance.sourceUrl ?? job.applyUrl ?? toHref("jobs.detail", { id: job.id });
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
            <span className="inline-flex items-center gap-1"><MapPin size={13} />{job.remoteMode === "REMOTE" ? "Remote" : `${job.city}, ${job.state}`}</span>
            <span>·</span><span>{job.employmentType ?? "Contract"}</span>
            {job.rateMax ? <><span>·</span><span className="font-mono">${job.rateMin}–{job.rateMax}/hr</span></> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="secondary" size="sm"><a href={sourceUrl} target="_blank" rel="noreferrer">Open source<ExternalLink size={13} /></a></Button>
          {context ? <Button size="sm"><Sparkles size={13} />Tailor & apply</Button> : <Button asChild size="sm"><Link href={toHref("jobs.detail", { id: job.id })}>View details<ArrowUpRight size={13} /></Link></Button>}
          <Button variant="secondary" size="icon" aria-label="More job actions" aria-expanded={menuOpen} onClick={onMenuToggle}><MoreHorizontal size={15} /></Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-2.5">
        <div className="flex items-center gap-3">
          {score !== null ? <><MatchScore score={score} /><span className="text-sm text-[var(--color-text-2)]">Matched to {context?.fullName}</span></> : <span className="text-sm text-[var(--color-text-3)]">Select a candidate to calculate a match score.</span>}
        </div>
        <div className="flex items-center gap-2"><VerificationBadge verification={job.company.verification} />{job.company.h1b?.sponsorsH1b ? <Tag tone="green">H-1B sponsor</Tag> : null}</div>
      </div>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -3, scale: 0.985 }} transition={POPOVER_TRANSITION} className="absolute right-5 top-16 z-30 w-56 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-md)]">
            <button type="button" onClick={onCopy} className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-sm text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Link copied" : "Copy job link"}</button>
            <a href={sourceUrl} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-sm text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"><ExternalLink size={14} />Open in new tab</a>
            <button type="button" onClick={onHide} className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-sm text-[var(--color-danger-fg)] hover:bg-[var(--color-danger-bg)]"><EyeOff size={14} />Hide this job</button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SourcePreview({ job, portal }: { job: Job; portal: PortalKey }) {
  const sourceUrl = job.provenance.sourceUrl ?? job.applyUrl;
  const lines = job.description.split("\n").filter(Boolean);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface-2)] p-4">
      <article className="mx-auto max-w-3xl overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <PortalLogo portal={portal} domain={job.company.domain} size={32} />
            <div className="min-w-0"><div className="text-body-strong text-[var(--color-text)]">{PORTALS[portal].label} source preview</div><div className="truncate text-caption text-[var(--color-text-3)]">{sourceUrl ?? job.company.websiteUrl ?? "Source URL unavailable"}</div></div>
          </div>
          {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-sm text-[var(--color-primary)] hover:underline">Open original<ArrowUpRight size={13} /></a> : null}
        </header>
        <div className="p-5">
          <div className="mb-5 flex items-start gap-3">
            <PortalLogo portal="COMPANY" domain={job.company.domain} size={40} />
            <div><h3 className="text-h2 text-[var(--color-text)]">{job.title}</h3><p className="mt-0.5 text-sm text-[var(--color-text-2)]">{job.company.name} · {job.remoteMode === "REMOTE" ? "Remote" : `${job.city}, ${job.state}`}</p><p className="mt-1 inline-flex items-center gap-1 text-caption text-[var(--color-text-3)]"><Clock3 size={12} />Posted {job.postedAt ? formatRelative(job.postedAt) : "recently"}{job.applicantCount ? ` · ${job.applicantCount} applicants` : ""}</p></div>
          </div>
          <div className="space-y-3 text-sm leading-6 text-[var(--color-text-2)]">
            {lines.map((line, index) => {
              const isHeading = /^(Responsibilities|Requirements|Nice to have):?$/.test(line);
              if (isHeading) return <h4 key={`${line}-${index}`} className="pt-2 text-body-strong text-[var(--color-text)]">{line.replace(/:$/, "")}</h4>;
              if (line.startsWith("- ")) return <p key={`${line}-${index}`} className="flex gap-2"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-primary)]" /><span>{line.slice(2)}</span></p>;
              return <p key={`${line}-${index}`}>{line}</p>;
            })}
          </div>
          <div className="mt-6 flex flex-wrap gap-1.5 border-t border-[var(--color-border)] pt-4">
            {job.requirements.slice(0, 8).map((requirement) => <Tag key={requirement.id} tone={requirement.kind === "MANDATORY" ? "blue" : "neutral"}>{requirement.value}</Tag>)}
          </div>
        </div>
      </article>
    </div>
  );
}
