"use client";

import { useAllResumes } from "@/lib/hooks/use-resumes";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useSession } from "@/lib/stores/session-store";
import { ResumeLibrary } from "@/components/app/resumes/resume-library";

export default function ResumesPage() {
  const { user } = useSession();
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
      canEdit={user.role !== "VIEWER"}
    />
  );
}
