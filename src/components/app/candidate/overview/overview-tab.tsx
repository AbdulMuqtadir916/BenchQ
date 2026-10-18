"use client";

import { useMemo } from "react";
import { rankJobsForCandidate } from "@/lib/derive";
import { useHref } from "@/lib/routes/use-href";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";
import { AttentionCard } from "./attention-card";
import { PipelineCard } from "./pipeline-card";
import { InboxPreview } from "./inbox-preview";
import { SubmissionFacts } from "./submission-facts";
import { ResumeReadiness, TopMatches } from "./side-cards";

/** Link into the master resume builder, landing on the first unverified claim. */
export function masterReviewHref(master: CandidateWorkspace["master"], toHref: ReturnType<typeof useHref>): string | null {
  return master ? toHref("resumes.studio", { id: master.resume.id }, { review: 1 }) : null;
}

/**
 * Overview: attention first (what to do now), then the pipeline and recruiter
 * news (where things stand), with the submission facts always to hand.
 */
export function OverviewTab({ ws, actions, canAct, onNotify }: { ws: CandidateWorkspace; actions: CandidateActions; canAct: boolean; onNotify: (message: string) => void }) {
  const toHref = useHref();
  const candidate = ws.candidate!;
  const matches = useMemo(
    () => rankJobsForCandidate(candidate, ws.jobsQuery.data ?? [], new Set(ws.applications.map((a) => a.jobId)), 3),
    [candidate, ws.jobsQuery.data, ws.applications],
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
        <AttentionCard ws={ws} actions={actions} />
        <div className="grid gap-5 xl:grid-cols-2">
          <PipelineCard applications={ws.applications} onOpen={() => actions.openTab("applications")} />
          <InboxPreview inbox={ws.inbox} isLoading={ws.inboxQuery.isLoading} firstName={candidate.fullName.split(" ")[0]!} onOpenMessage={actions.openMessage} onOpenInbox={() => actions.openTab("inbox")} />
        </div>
      </div>
      <div className="space-y-5">
        <TopMatches matches={matches} onFindJobs={actions.findJobs} />
        <SubmissionFacts candidate={candidate} canEdit={canAct} onSaved={() => onNotify("Submission facts updated")} />
        <ResumeReadiness master={ws.master} reviewHref={masterReviewHref(ws.master, toHref)} />
      </div>
    </div>
  );
}
