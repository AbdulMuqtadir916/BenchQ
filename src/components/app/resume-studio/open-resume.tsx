"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useOpenedResume, useResumeShelf } from "@/lib/hooks/use-resumes";
import { baseNumber } from "@/lib/derive/resume-tree";
import { baseName, roleOf, tailoredName, versionName } from "@/lib/derive/resume-name";
import { useTreeLabels } from "@/components/app/resumes/use-tree-labels";
import { useCandidate } from "@/lib/hooks/use-candidates";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { canChangeResume } from "@/lib/auth/permissions";
import { ErrorState } from "@/components/app/error-state";
import { NotFoundState } from "@/components/app/not-found-state";
import { isNotFoundError } from "@/lib/api/client";
import { useRouteAccess } from "@/lib/routes/use-route-access";
import { isInScope } from "@/lib/routes/scope";
import { useHref } from "@/lib/routes/use-href";
import { ResumeStudio } from "./resume-studio";
import { StudioFrame, StudioSkeleton } from "./studio-states";
import { useStudio, type StudioMode } from "./studio-store";
import { useStudioSave } from "./use-studio-save";
import { UseAsBaseDialog } from "./use-as-base-dialog";

/** Close = go back to wherever the user opened the resume from, or the library on a direct visit. */
export function useCloseStudio() {
  const router = useRouter();
  const toHref = useHref();
  return useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push(toHref("resumes"));
  }, [router, toHref]);
}

export function OpenResume({ id, initialMode }: { id: string; initialMode: StudioMode }) {
  const toHref = useHref();
  const principal = useSignedInPrincipal();
  const close = useCloseStudio();
  // `id` is the version's: the studio opens exactly that version (its text), not its résumé's newest.
  const openedQuery = useOpenedResume(id);
  const candidateId = openedQuery.data?.resume.candidateId ?? "";
  const candidateQuery = useCandidate(candidateId);
  const shelfQuery = useResumeShelf(candidateId);
  const shown = useMemo(() => (candidateQuery.data ? [candidateQuery.data] : []), [candidateQuery.data]);
  const labels = useTreeLabels(shown, shelfQuery.data);
  const loadedId = useStudio((s) => s.doc?.resumeId);
  const load = useStudio((s) => s.load);
  const setMode = useStudio((s) => s.setMode);
  const { access } = useRouteAccess();
  const { onSave, isSaving } = useStudioSave(id, initialMode);
  const inScope = !candidateQuery.data || isInScope(access, principal.userId, { bdeId: candidateQuery.data.bdeId, managerId: candidateQuery.data.managerId });

  useEffect(() => {
    // The store, not this render's `loadedId`: an effect that runs twice (React's dev mode) must load once.
    if (!inScope || !openedQuery.data || !candidateQuery.data || useStudio.getState().doc?.resumeId === id) return;
    const { pendingNotice, notify, setPendingNotice } = useStudio.getState();
    load(openedQuery.data.document, initialMode, !!pendingNotice); // after a save: same layout, the next version
    if (pendingNotice) {
      notify(pendingNotice.text, pendingNotice.tone);
      setPendingNotice(null);
    }
  }, [inScope, openedQuery.data, candidateQuery.data, loadedId, id, initialMode, load]);

  // Reopening the same resume keeps this session's edits but honours how it was opened (View vs card).
  useEffect(() => setMode(initialMode), [id, initialMode, setMode]);

  const error = openedQuery.error ?? candidateQuery.error;
  // A missing or deleted version (or its candidate) and one outside the user's scope look the same: not-found (07 Q6).
  const notFoundState = (
    <StudioFrame onClose={close}>
      <NotFoundState title="Resume not found" description="This resume doesn't exist or isn't available to you." backHref={toHref("resumes")} backLabel="Back to resumes" />
    </StudioFrame>
  );
  if ([openedQuery.error, candidateQuery.error].some(isNotFoundError)) return notFoundState;
  if (error) {
    return (
      <StudioFrame onClose={close}>
        <ErrorState
          variant="page"
          error={error}
          onRetry={() => {
            void openedQuery.refetch();
            void candidateQuery.refetch();
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
  const opened = openedQuery.data;
  const number = opened?.resume.baseResumeId && shelfQuery.data ? baseNumber(shelfQuery.data, opened.resume.baseResumeId) : null;
  const versionNumber = opened?.resume.versions.find((v) => v.id === opened.versionId)?.versionNumber ?? 1;
  // The convention (src/lib/derive/resume-name.ts); until the shelf has loaded, the document's own name.
  const name = !opened ? "" : opened.resume.isMaster
    ? (number ? versionName(baseName(candidate?.fullName, roleOf(opened.resume.name, candidate?.primaryRole), number), versionNumber) : opened.document.name)
    : versionName(tailoredName(candidate?.fullName, opened.resume.targetJobId ? labels.job(opened.resume.targetJobId) : null), versionNumber);
  return (
    <>
      <ResumeStudio
        name={name}
        subtitle={[candidate?.fullName, candidate?.primaryRole].filter(Boolean).join(" · ")}
        canEdit={!!candidate && canChangeResume(principal, candidate)}
        onClose={close}
        onSave={onSave}
        isSaving={isSaving}
      />
      <UseAsBaseDialog />
    </>
  );
}
