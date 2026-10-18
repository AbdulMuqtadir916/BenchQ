"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { ArrowLeft, Sparkles, Send, Mail, Bookmark, Building2, Check, X, Minus } from "lucide-react";
import { useJob } from "@/lib/hooks/use-jobs";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useSignedInUser } from "@/lib/stores/session-store";
import { deriveMatchScore } from "@/lib/derive";
import type { Job, JobRequirement } from "@/lib/schemas/job";
import type { Candidate } from "@/lib/schemas/candidate";
import { PageHeader } from "@/components/app/page-header";
import { VerificationBadge } from "@/components/app/verification-badge";
import { SourceChip } from "@/components/app/source-chip";
import { MatchScore } from "@/components/app/match-score";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import { DualTimestamp } from "@/components/app/dual-timestamp";
import { AgentRunPanel, useAgentRun } from "@/components/app/ai";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { ErrorState } from "@/components/app/error-state";
import { NotFoundState } from "@/components/app/not-found-state";
import { isNotFoundError } from "@/lib/api/client";
import { useHref } from "@/lib/routes/use-href";

const ANALYSIS_STAGES = [
  "Reading the job description",
  "Extracting requirements",
  "Matching against the record",
  "Scoring and drafting tips",
] as const;

type ReqMatch = "HAVE" | "MISSING" | "ADJACENT";

function matchRequirement(req: JobRequirement, candidate: Candidate | null): ReqMatch {
  if (!candidate) return "ADJACENT";
  const hay = [candidate.primaryRole ?? "", ...candidate.targetRoles].join(" ").toLowerCase();
  const needle = (req.canonicalValue ?? req.value).toLowerCase();
  if (hay.includes(needle.split(" ")[0] ?? needle)) return "HAVE";
  return req.kind === "MANDATORY" ? "MISSING" : "ADJACENT";
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const toHref = useHref();
  const { id } = use(params);
  const user = useSignedInUser();
  const jobQuery = useJob(id);
  const candidatesQuery = useCandidates();

  const myCandidates = useMemo(() => {
    const cs = candidatesQuery.data ?? [];
    return user.role === "BDE" ? cs.filter((c) => c.assignedUserIds.includes(user.id)) : cs;
  }, [candidatesQuery.data, user]);

  const [candidateId, setCandidateId] = useState("");
  const context = myCandidates.find((c) => c.id === candidateId) ?? null;

  const run = useAgentRun(ANALYSIS_STAGES.length);
  const canAct = user.role !== "VIEWER";

  if (jobQuery.isLoading) return <div className="bq-page"><SkeletonCard /></div>;
  if (isNotFoundError(jobQuery.error)) {
    return <NotFoundState title="Job not found" description="This job doesn't exist or isn't available to you." backHref={toHref("jobs")} backLabel="Back to jobs" />;
  }
  if (jobQuery.error || !jobQuery.data) return <div className="bq-page"><ErrorState error={jobQuery.error as Error} /></div>;

  const job: Job = jobQuery.data;
  const score = context ? deriveMatchScore(context, job) : null;
  const analysisReady = run.status === "complete";

  return (
    <div className="bq-page">
      <Link href={toHref("jobs")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-3)] hover:text-[var(--color-text)]">
        <ArrowLeft size={14} aria-hidden /> Jobs
      </Link>

      <PageHeader
        title={job.title}
        subtitle={`${job.company.name} · ${job.remoteMode === "REMOTE" ? "Remote" : `${job.city}, ${job.state}`}${job.rateMax ? ` · $${job.rateMin}–${job.rateMax}/hr` : ""}`}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <VerificationBadge verification={job.company.verification} />
        <SourceChip sourceType={job.provenance.sourceType} legalBasis={job.provenance.legalBasis} showBasis />
        {job.postedAt ? <span className="text-caption text-[var(--color-text-3)]">Posted <DualTimestamp iso={job.postedAt} format="relative" /></span> : null}
        <span className="text-caption text-[var(--color-text-3)]">· Captured <DualTimestamp iso={job.provenance.ingestedAt} format="relative" /></span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader><CardTitle>Description</CardTitle></CardHeader>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-2)]">{job.description}</div>
          {job.requirements.length > 0 ? (
            <div className="mt-5">
              <h3 className="text-label mb-2 text-[var(--color-text-3)]">Requirements</h3>
              <div className="flex flex-wrap gap-1.5">
                {job.requirements.map((r) => (
                  <Tag key={r.id} tone={r.kind === "MANDATORY" ? "blue" : "neutral"}>{r.value}</Tag>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader><CardTitle>Match</CardTitle>{score !== null ? <MatchScore score={score} /> : null}</CardHeader>
            <select value={candidateId} onChange={(e) => { setCandidateId(e.target.value); run.reset(); }} className="bq-input mb-3">
              <option value="">Pick a candidate to score</option>
              {myCandidates.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>

            {!context ? (
              <p className="text-caption text-[var(--color-text-3)]">Select a candidate to see requirement-by-requirement fit.</p>
            ) : run.status === "idle" ? (
              <div>
                <p className="mb-3 text-caption text-[var(--color-text-3)]">Light score shown. Run full analysis for the requirement matrix and ATS tips.</p>
                <Button onClick={run.start} variant="secondary" size="sm" className="w-full"><Sparkles size={14} aria-hidden />Run full analysis</Button>
              </div>
            ) : run.status === "running" ? (
              <AgentRunPanel title="Analysing fit" stages={ANALYSIS_STAGES} activeStage={run.activeStage} status={run.status} elapsedMs={run.elapsedMs} />
            ) : run.status === "fallback" ? (
              <AgentRunPanel title="Analysing fit" stages={ANALYSIS_STAGES} activeStage={run.activeStage} status={run.status} fallbackMessage="Analysis unavailable. The light score still stands; review requirements manually." />
            ) : null}

            {analysisReady && context ? (
              <div className="mt-3 space-y-1.5">
                <div className="mb-1 flex items-center gap-2 text-caption text-[var(--color-unverified-fg)]">
                  <Sparkles size={12} aria-hidden /> AI draft — verified once you confirm evidence
                </div>
                {job.requirements.map((r) => {
                  const m = matchRequirement(r, context);
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-[var(--color-text-2)] truncate">{r.value}</span>
                      {m === "HAVE" ? (
                        <span className="inline-flex items-center gap-1 text-[var(--color-success-fg)]"><Check size={13} aria-hidden />Have</span>
                      ) : m === "MISSING" ? (
                        <span className="inline-flex items-center gap-1 text-[var(--color-danger-fg)]"><X size={13} aria-hidden />Missing</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[var(--color-text-3)]"><Minus size={13} aria-hidden />Adjacent</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Building2 size={15} aria-hidden />{job.company.name}</CardTitle></CardHeader>
            <div className="space-y-2 text-sm">
              <Row label="Client type" value={job.company.clientType.replaceAll("_", " ").toLowerCase()} />
              <Row label="Employees" value={job.company.employeeBand ?? "unknown"} />
              {job.company.h1b ? (
                <>
                  <Row label="Sponsors H-1B" value={job.company.h1b.sponsorsH1b === null ? "unknown" : job.company.h1b.sponsorsH1b ? "yes" : "no"} />
                  {job.company.h1b.lcaCount ? <Row label="LCAs (2025)" value={`${job.company.h1b.lcaCount}`} /> : null}
                  {job.company.h1b.medianLcaWage ? <Row label="Median LCA wage" value={`$${job.company.h1b.medianLcaWage.toLocaleString()}`} /> : null}
                </>
              ) : null}
            </div>
          </Card>

          {canAct ? (
            <div className="grid grid-cols-2 gap-2">
              <Button asChild><Link href={toHref("resumes.studio", { id: "new" })}><Sparkles size={14} aria-hidden />Tailor</Link></Button>
              <Button variant="secondary"><Send size={14} aria-hidden />Mark applied</Button>
              <Button asChild variant="secondary"><Link href={toHref("outreach")}><Mail size={14} aria-hidden />Outreach</Link></Button>
              <Button variant="ghost"><Bookmark size={14} aria-hidden />Save</Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--color-text-3)]">{label}</span>
      <span className="text-[var(--color-text-2)] capitalize">{value}</span>
    </div>
  );
}
