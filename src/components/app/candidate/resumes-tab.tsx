"use client";

import { useId, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import type { ResumeShelf } from "@/lib/schemas/resume";
import { buildResumeTree } from "@/lib/derive/resume-tree";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useTreeLabels } from "@/components/app/resumes/use-tree-labels";
import { UploadResume } from "@/components/app/resumes/upload-resume";
import { ResumeCard } from "./resumes/resume-card";
import { resumeCards } from "./resumes/resume-cards";
import { Reveal } from "./resumes/resume-versions";
import { useCardActions } from "./resumes/use-card-actions";

/**
 * This candidate's résumés, for a recruiter: which one goes out (the main résumé, first), how to see or download it,
 * and how to update it. Older versions and job copies wait behind links in each card.
 */
export function ResumesTab({ candidate, shelf, isLoading, error, onRetry, canAct, onMakeJobCopy }: {
  candidate: Candidate;
  shelf: ResumeShelf | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  canAct: boolean;
  /** "Make a copy for a job": job copies are made from a job, on the Jobs tab. */
  onMakeJobCopy?: () => void;
}) {
  const candidates = useMemo(() => [candidate], [candidate]);
  const labels = useTreeLabels(candidates, shelf);
  const tree = useMemo(() => (shelf ? buildResumeTree(shelf, [candidate.id])[0] : undefined), [shelf, candidate.id]);
  const cards = useMemo(() => resumeCards(tree?.bases ?? [], candidate.primaryRole), [tree, candidate.primaryRole]);
  const hiddenCards = useMemo(() => resumeCards(tree?.hidden ?? [], candidate.primaryRole), [tree, candidate.primaryRole]);
  const { actions, dialogs } = useCardActions(candidate);
  const [isHiddenOpen, setHiddenOpen] = useState(false);
  const hiddenId = useId();
  const canUpload = canAct && actions.canManage;
  // "Create new résumé" waits until the new-résumé screen can save (it can only download today).

  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading résumés" className="space-y-3">
        <Skeleton className="h-6 w-40" />
        {[0, 1].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }
  if (!cards.length && !(canUpload && hiddenCards.length)) {
    return (
      <EmptyState icon={FileText} title="No résumé yet"
        description={canUpload ? "Upload the candidate's résumé file." : "The candidate's recruiter adds their first résumé."}
        action={canUpload ? <UploadResume candidateId={candidate.id} label="Upload a file" /> : undefined} />
    );
  }

  const shared = { labels, candidateName: candidate.fullName, actions: canAct ? actions : undefined };
  return (
    <section aria-labelledby="resumes-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h2 id="resumes-heading" className="text-h3 text-[var(--color-text)]">Résumés ({cards.length})</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-2)]">The main résumé is the one we send to jobs by default.</p>
        </div>
        {canUpload ? <UploadResume candidateId={candidate.id} /> : null}
      </div>

      <ul className="space-y-3">
        {cards.map((card) => <ResumeCard key={card.node.base.id} card={card} {...shared} onMakeJobCopy={onMakeJobCopy} />)}
      </ul>

      {canUpload && hiddenCards.length ? (
        <div className="mt-6">
          <Reveal label={`Hidden résumés (${hiddenCards.length})`} isOpen={isHiddenOpen} onToggle={() => setHiddenOpen(!isHiddenOpen)} controls={hiddenId} />
          {isHiddenOpen ? (
            <div id={hiddenId} className="mt-2">
              <p className="mb-2 text-sm text-[var(--color-text-2)]">Taken off the list because they were sent with applications that are still open.</p>
              <ul className="space-y-3">{hiddenCards.map((card) => <ResumeCard key={card.node.base.id} card={card} {...shared} />)}</ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {dialogs}
    </section>
  );
}
