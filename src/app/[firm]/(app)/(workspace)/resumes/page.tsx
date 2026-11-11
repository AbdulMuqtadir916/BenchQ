"use client";

import { useMemo } from "react";
import { useFirmResumeShelf } from "@/lib/hooks/use-resumes";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { can, canManageResume, scopeByCandidate, scopeCandidates } from "@/lib/auth/permissions";
import { useResumeActions } from "@/components/app/resumes/use-resume-actions";
import { ResumeLibrary } from "@/components/app/resumes/resume-library";

export default function ResumesPage() {
  const principal = useSignedInPrincipal();
  const shelfQuery = useFirmResumeShelf();
  const candidatesQuery = useCandidates();
  const error = (shelfQuery.error ?? candidatesQuery.error) as Error | null;
  const candidates = useMemo(() => candidatesQuery.data ?? [], [candidatesQuery.data]);

  // The backend already scopes the list (07 Q47); on mocks the same rule is applied here.
  const shelf = useMemo(() => ({
    bases: scopeByCandidate(principal, shelfQuery.data?.bases ?? [], candidates),
    resumes: scopeByCandidate(principal, shelfQuery.data?.resumes ?? [], candidates),
  }), [principal, shelfQuery.data, candidates]);
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const { actions, dialogs } = useResumeActions((id) => byId.get(id));

  return (
    <>
    <ResumeLibrary
      shelf={shelf}
      candidates={scopeCandidates(principal, candidates)}
      isLoading={shelfQuery.isLoading || candidatesQuery.isLoading}
      error={error}
      onRetry={() => { void shelfQuery.refetch(); void candidatesQuery.refetch(); }}
      canSeeHidden={(id) => { const c = byId.get(id); return !!c && canManageResume(principal, c); }}
      actions={can(principal, "resume.edit") ? actions : undefined}
    />
    {dialogs}
    </>
  );
}
