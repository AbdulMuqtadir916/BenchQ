"use client";

import Link from "next/link";
import { useMemo } from "react";
import { FileText } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import type { ResumeShelf } from "@/lib/schemas/resume";
import { buildResumeTree } from "@/lib/derive/resume-tree";
import { canManageResume } from "@/lib/auth/permissions";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ResumeTree } from "@/components/app/resumes/resume-tree";
import { useTreeLabels } from "@/components/app/resumes/use-tree-labels";
import { useResumeActions } from "@/components/app/resumes/use-resume-actions";
import { UploadResume } from "@/components/app/resumes/upload-resume";
import { useHref } from "@/lib/routes/use-href";

/** This candidate's résumés: the same tree as the Resume Builder library, the active base open. */
export function ResumesTab({ candidate, shelf, isLoading, error, onRetry, canAct }: { candidate: Candidate; shelf: ResumeShelf | undefined; isLoading: boolean; error: Error | null; onRetry: () => void; canAct: boolean }) {
  const toHref = useHref();
  const principal = useSignedInPrincipal();
  const labels = useTreeLabels();
  const tree = useMemo(() => (shelf ? buildResumeTree(shelf, [candidate.id]) : []), [shelf, candidate.id]);
  const { actions, dialogs } = useResumeActions((id) => (id === candidate.id ? candidate : undefined));
  const canUpload = canManageResume(principal, candidate);

  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading resumes" className="space-y-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }
  if (tree.length === 0) {
    return <EmptyState icon={FileText} title="No résumés yet" description="The first base résumé is made when the candidate is added." action={canAct ? <Button asChild><Link href={toHref("resumes.studio", { id: "new" })}>Build résumé</Link></Button> : undefined} />;
  }
  return (
    <div className="space-y-4">
      {canAct && canUpload ? <div className="flex justify-end"><UploadResume candidateId={candidate.id} /></div> : null}
      <ResumeTree tree={tree} labels={labels} openActive canSeeHidden={() => canUpload} actions={canAct ? actions : undefined} />
      {dialogs}
    </div>
  );
}
