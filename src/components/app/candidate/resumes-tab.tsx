"use client";

import { useMemo } from "react";
import { FileText } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import type { ResumeShelf } from "@/lib/schemas/resume";
import { buildResumeTree } from "@/lib/derive/resume-tree";
import Link from "next/link";
import { canChangeResume, canManageResume } from "@/lib/auth/permissions";
import { useHref } from "@/lib/routes/use-href";
import { Button } from "@/components/ui/button";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ResumeTree } from "@/components/app/resumes/resume-tree";
import { useTreeLabels } from "@/components/app/resumes/use-tree-labels";
import { useResumeActions } from "@/components/app/resumes/use-resume-actions";
import { UploadResume } from "@/components/app/resumes/upload-resume";

/** This candidate's résumés: the same tree as the Resume Builder library, the active base open. */
export function ResumesTab({ candidate, shelf, isLoading, error, onRetry, canAct }: { candidate: Candidate; shelf: ResumeShelf | undefined; isLoading: boolean; error: Error | null; onRetry: () => void; canAct: boolean }) {
  const principal = useSignedInPrincipal();
  const candidates = useMemo(() => [candidate], [candidate]);
  const labels = useTreeLabels(candidates);
  const tree = useMemo(() => (shelf ? buildResumeTree(shelf, [candidate.id]) : []), [shelf, candidate.id]);
  const { actions, dialogs } = useResumeActions((id) => (id === candidate.id ? candidate : undefined));
  const canUpload = canManageResume(principal, candidate);
  const canBuild = canChangeResume(principal, candidate);
  const toHref = useHref();
  // No résumé yet: no base at all, or only the one made from the New candidate form (no file, no résumé content).
  const formBase = shelf?.bases.find((b) => b.candidateId === candidate.id && !b.hasResume && b.isActive);
  const formV1 = formBase ? shelf?.resumes.find((r) => r.isMaster && r.baseResumeId === formBase.id) : undefined;
  const hasResume = !!shelf?.bases.some((b) => b.candidateId === candidate.id && b.hasResume);

  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading resumes" className="space-y-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }
  if (!hasResume) {
    const build = canAct && canBuild && formV1 ? (
      <Button asChild variant="secondary"><Link href={toHref("resumes.studio", { id: formV1.latestVersionId ?? formV1.versions[0]!.id })}>Build it from the form details</Link></Button>
    ) : null;
    const upload = canAct && canUpload ? <UploadResume candidateId={candidate.id} /> : null;
    return (
      <EmptyState icon={FileText} title="No résumé uploaded yet"
        description={upload || build ? "Upload the candidate's résumé, or build one in the studio from the details entered when the candidate was added." : "The candidate's BDE uploads or builds their résumé."}
        action={upload || build ? <div className="flex flex-wrap justify-center gap-2">{upload}{build}</div> : undefined} />
    );
  }
  return (
    <div>
      <ResumeTree tree={tree} labels={labels} openActive canSeeHidden={() => canUpload} actions={canAct ? actions : undefined} />
      {dialogs}
    </div>
  );
}
