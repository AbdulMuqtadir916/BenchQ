"use client";

import { useAllResumes } from "@/lib/hooks/use-resumes";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { can } from "@/lib/auth/permissions";
import { ResumeLibrary } from "@/components/app/resumes/resume-library";

export default function ResumesPage() {
  const principal = useSignedInPrincipal();
  const resumesQuery = useAllResumes();
  const candidatesQuery = useCandidates();
  const error = (resumesQuery.error ?? candidatesQuery.error) as Error | null;

  return (
    <ResumeLibrary
      resumes={resumesQuery.data ?? []}
      candidates={candidatesQuery.data ?? []}
      isLoading={resumesQuery.isLoading || candidatesQuery.isLoading}
      error={error}
      onRetry={() => { void resumesQuery.refetch(); void candidatesQuery.refetch(); }}
      canEdit={can(principal, "resume.edit")}
    />
  );
}
