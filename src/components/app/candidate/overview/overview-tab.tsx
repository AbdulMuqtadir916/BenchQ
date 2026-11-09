"use client";

import { useMemo } from "react";
import { rankJobsForCandidate } from "@/lib/derive";
import type { CandidateWorkspace } from "../use-candidate-workspace";
import type { CandidateActions } from "../candidate-actions";
import { AttentionCard } from "./attention-card";
import { PipelineCard } from "./pipeline-card";
import { InboxPreview } from "./inbox-preview";
import { HandoffNote } from "./handoff-note";
import { SubmissionFacts } from "./submission-facts";
import { BaseResumeCard, TopMatches } from "./side-cards";

/**
 * Overview: attention first (what to do now), then the pipeline and recruiter
 * news (where things stand), with the submission facts always to hand.
 */
export function OverviewTab({ ws, actions, canAct, canEditProfile, onNotify }: { ws: CandidateWorkspace; actions: CandidateActions; canAct: boolean; /** 07 Q56: the OWNER and MANAGER edit the profile. */ canEditProfile: boolean; onNotify: (message: string) => void }) {
  const candidate = ws.candidate!;
  const matches = useMemo(
    () => rankJobsForCandidate(candidate, ws.jobsQuery.data ?? [], new Set(ws.applications.map((a) => a.jobId)), 3),
    [candidate, ws.jobsQuery.data, ws.applications],
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
        <AttentionCard ws={ws} actions={actions} canAct={canAct} />
        <div className="grid gap-5 xl:grid-cols-2">
          <PipelineCard applications={ws.applications} onOpen={() => actions.openTab("applications")} />
          <InboxPreview inbox={ws.inbox} isLoading={ws.inboxQuery.isLoading} firstName={candidate.fullName.split(" ")[0]!} canAct={canAct} onOpenMessage={actions.openMessage} onOpenInbox={() => actions.openTab("inbox")} />
        </div>
      </div>
      <div className="space-y-5">
        <HandoffNote candidateId={candidate.id} />
        <TopMatches matches={matches} onFindJobs={actions.findJobs} />
        <SubmissionFacts candidate={candidate} canEdit={canEditProfile} onSaved={() => onNotify("Submission facts updated")} />
        <BaseResumeCard base={ws.base} onOpenResumes={() => actions.openTab("resumes")} />
      </div>
    </div>
  );
}
