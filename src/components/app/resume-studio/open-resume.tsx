"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useResume } from "@/lib/hooks/use-resumes";
import { useCandidate } from "@/lib/hooks/use-candidates";
import { useRecord } from "@/lib/hooks/use-records";
import { useSignedInUser } from "@/lib/stores/session-store";
import { buildResumeDocument } from "@/lib/resume-doc/build";
import { deriveDocumentGate } from "@/lib/derive";
import { ErrorState } from "@/components/app/error-state";
import { NotFoundState } from "@/components/app/not-found-state";
import { isNotFoundError } from "@/lib/api/client";
import { useRouteAccess } from "@/lib/routes/use-route-access";
import { isInScope } from "@/lib/routes/scope";
import { useHref } from "@/lib/routes/use-href";
import { ResumeStudio } from "./resume-studio";
import { StudioFrame, StudioSkeleton } from "./studio-states";
import { useStudio, type StudioMode } from "./studio-store";

/** Close = go back to wherever the user opened the resume from, or the library on a direct visit. */
export function useCloseStudio() {
  const router = useRouter();
  const toHref = useHref();
  return useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push(toHref("resumes"));
  }, [router, toHref]);
}

export function OpenResume({ id, initialMode, review = false }: { id: string; initialMode: StudioMode; review?: boolean }) {
  const toHref = useHref();
  const user = useSignedInUser();
  const close = useCloseStudio();
  const resumeQuery = useResume(id);
  const candidateId = resumeQuery.data?.candidateId ?? "";
  const candidateQuery = useCandidate(candidateId);
  const recordQuery = useRecord(candidateId);
  const loadedId = useStudio((s) => s.doc?.resumeId);
  const load = useStudio((s) => s.load);
  const setMode = useStudio((s) => s.setMode);
  const { access } = useRouteAccess();
  const inScope = !candidateQuery.data || isInScope(access, user.id, { assignedUserIds: candidateQuery.data.assignedUserIds });

  useEffect(() => {
    if (!inScope || !resumeQuery.data || !candidateQuery.data || !recordQuery.data || loadedId === id) return;
    load(buildResumeDocument(resumeQuery.data, candidateQuery.data, recordQuery.data), initialMode);
  }, [inScope, resumeQuery.data, candidateQuery.data, recordQuery.data, loadedId, id, initialMode, load]);

  // Reopening the same resume keeps this session's edits but honours how it was opened (View vs card).
  useEffect(() => setMode(review ? "build" : initialMode), [id, initialMode, review, setMode]);

  // "Review unverified claims" from the candidate page lands on the first one, once.
  const reviewed = useRef(false);
  useEffect(() => {
    if (!review || reviewed.current || loadedId !== id) return;
    reviewed.current = true;
    const { doc, jumpToClaim } = useStudio.getState();
    const first = doc ? deriveDocumentGate(doc).blockingClaimIds[0] : undefined;
    if (first) jumpToClaim(first);
  }, [review, loadedId, id]);

  const error = resumeQuery.error ?? candidateQuery.error ?? recordQuery.error;
  // A missing resume (or its candidate / record) and one outside the user's scope look the same: not-found (07 Q6).
  const notFoundState = (
    <StudioFrame onClose={close}>
      <NotFoundState title="Resume not found" description="This resume doesn't exist or isn't available to you." backHref={toHref("resumes")} backLabel="Back to resumes" />
    </StudioFrame>
  );
  if ([resumeQuery.error, candidateQuery.error, recordQuery.error].some(isNotFoundError)) return notFoundState;
  if (error) {
    return (
      <StudioFrame onClose={close}>
        <ErrorState
          variant="page"
          error={error}
          onRetry={() => {
            void resumeQuery.refetch();
            void candidateQuery.refetch();
            void recordQuery.refetch();
          }}
        />
      </StudioFrame>
    );
  }

  if (!inScope) return notFoundState;

  if (loadedId !== id) {
    return (
      <StudioFrame onClose={close}>
        <StudioSkeleton />
      </StudioFrame>
    );
  }

  const candidate = candidateQuery.data;
  return (
    <ResumeStudio
      subtitle={[candidate?.fullName, candidate?.primaryRole].filter(Boolean).join(" · ")}
      canEdit={user.role !== "VIEWER"}
      onClose={close}
    />
  );
}
