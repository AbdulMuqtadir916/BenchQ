"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { can } from "@/lib/auth/permissions";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useMoveCandidateApplicationStatus } from "@/lib/hooks/use-applications";
import { useReviewInboxMessage, useRetryInboxClassification } from "@/lib/hooks/use-inbox";
import { EASE_OUT } from "@/lib/motion";
import { ErrorState } from "@/components/app/error-state";
import { NotFoundState } from "@/components/app/not-found-state";
import { isNotFoundError } from "@/lib/api/client";
import { useRouteAccess } from "@/lib/routes/use-route-access";
import { isInScope } from "@/lib/routes/scope";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { CandidateJobsTab } from "@/components/app/candidate/candidate-jobs-tab";
import { CandidateHeader } from "@/components/app/candidate/candidate-header";
import { CandidateTabs, isCandidateTab, type CandidateTabId } from "@/components/app/candidate/candidate-tabs";
import { CandidateToast } from "@/components/app/candidate/candidate-toast";
import { useCandidateWorkspace } from "@/components/app/candidate/use-candidate-workspace";
import type { CandidateActions } from "@/components/app/candidate/candidate-actions";
import { OverviewTab, masterReviewHref } from "@/components/app/candidate/overview/overview-tab";
import { DocumentsTab } from "@/components/app/candidate/documents/documents-tab";
import { ApplicationsTab } from "@/components/app/candidate/applications/applications-tab";
import { ApplicationDrawer } from "@/components/app/candidate/applications/application-drawer";
import { InboxTab } from "@/components/app/candidate/inbox/inbox-tab";
import { ResumesTab } from "@/components/app/candidate/resumes-tab";
import { ActivityTab } from "@/components/app/candidate/activity-tab";
import { STATUS_LABEL } from "@/components/app/applications/status-meta";
import { useHref } from "@/lib/routes/use-href";

const EmailSelectionSchema = z.string().min(1).max(100).nullable().catch(null);

export default function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const toHref = useHref();
  const { id } = use(params);
  const principal = useSignedInPrincipal();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const selectedMessageId = EmailSelectionSchema.parse(searchParams.get("message"));
  const tab: CandidateTabId = isCandidateTab(tabParam) ? tabParam : "overview";
  const reduce = useReducedMotion() ?? false;
  const ws = useCandidateWorkspace(id, selectedMessageId);
  const { access } = useRouteAccess();
  const moveCandidateStatus = useMoveCandidateApplicationStatus(id);
  const reviewInboxMessage = useReviewInboxMessage(id);
  const retryInboxClassification = useRetryInboxClassification(id);
  const canAct = can(principal, "candidate.edit");

  const tabsRef = useRef<HTMLDivElement>(null);
  const [openApplicationId, setOpenApplicationId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Each "Find jobs" press starts a matching run; the Jobs tab plays it until it reports done.
  const [matchRun, setMatchRun] = useState(0);
  const [matchDone, setMatchDone] = useState(0);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // The tab lives in the URL, so back/forward and shared links land on the same view.
  const setTab = useCallback(
    (next: CandidateTabId) => {
      router.replace(toHref("candidates.detail", { id }, next === "overview" ? undefined : { tab: next }), { scroll: false });
      requestAnimationFrame(() => {
        const bar = tabsRef.current;
        if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      });
    },
    [router, toHref, id, reduce],
  );

  const openMessage = useCallback((messageId: string) => {
    setOpenApplicationId(null);
    window.history.pushState(null, "", toHref("candidates.detail", { id }, { tab: "inbox", message: messageId }));
  }, [toHref, id]);

  const moveApplication = useCallback(
    (applicationId: string, to: ApplicationStatus, note: string | null = null) => {
      const app = ws.applications.find((a) => a.id === applicationId);
      moveCandidateStatus.mutate({ id: applicationId, status: to, expectedRevision: app?.statusRevision ?? 0, commandId: crypto.randomUUID() }, {
        onSuccess: () => setToast(`${app?.companyNameAtApply ?? "Application"} moved to ${STATUS_LABEL[to]}`),
        onError: (error) => setToast(error.message || "Couldn't update application status."),
      });
      void note;
    },
    [ws.applications, moveCandidateStatus],
  );

  const actions = useMemo<CandidateActions>(() => ({
    openTab: setTab,
    openApplication: setOpenApplicationId,
    openMessage,
    applySuggestion: (suggestion) => openMessage(suggestion.message.id),
    reviewInboxMessage: (input) => reviewInboxMessage.mutate(input, {
      onSuccess: () => setToast("Application status updated from the Inbox review."),
      onError: (error) => setToast(error.message || "Couldn't confirm the email status."),
    }),
    retryInboxClassification: (messageId) => retryInboxClassification.mutate(messageId, {
      onSuccess: () => setToast("Email classification queued for retry."),
      onError: (error) => setToast(error.message || "Couldn't retry email classification."),
    }),
    findJobs: () => {
      setMatchRun((n) => n + 1);
      setTab("jobs");
      requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
    },
    reviewMasterResume: () => {
      const href = masterReviewHref(ws.master, toHref);
      if (href) router.push(href);
    },
  }), [setTab, openMessage, reduce, router, ws.master, toHref, reviewInboxMessage, retryInboxClassification]);

  const closeDrawer = useCallback(() => setOpenApplicationId(null), []);
  const finishMatch = useCallback(() => setMatchDone(matchRun), [matchRun]);

  if (ws.candidateQuery.isLoading) return <div className="bq-page space-y-4"><SkeletonCard /><SkeletonCard /></div>;
  // A missing record and a record outside the user's scope look the same: not-found, never confirm existence (07 Q6).
  const notFoundState = <NotFoundState title="Candidate not found" description="This candidate doesn't exist or isn't available to you." backHref={toHref("candidates")} backLabel="Back to candidates" />;
  if (isNotFoundError(ws.candidateQuery.error)) return notFoundState;
  if (ws.candidateQuery.error || !ws.candidate) {
    return <div className="bq-page"><ErrorState variant="page" error={ws.candidateQuery.error ?? new Error("Candidate not found.")} onRetry={() => void ws.candidateQuery.refetch()} /></div>;
  }
  const candidate = ws.candidate;
  if (!isInScope(access, principal.userId, { bdeId: candidate.bdeId, managerId: candidate.managerId })) {
    return notFoundState;
  }
  const resumes = ws.resumesQuery.data ?? [];

  return (
    <div className="bq-page">
      <CandidateHeader
        candidate={candidate}
        stats={ws.stats}
        ownerName={ws.ownerName}
        showOwner={can(principal, "team.view")}
        canAct={canAct}
        resumeHref={toHref("resumes.studio", { id: resumes[0]?.id ?? "new" })}
        onFindJobs={actions.findJobs}
        onOpenTab={setTab}
      />

      <CandidateTabs
        ref={tabsRef}
        value={tab}
        onChange={setTab}
        counts={{ applications: ws.stats?.applicationsSubmitted, resumes: resumes.length, documents: ws.documentsQuery.data?.length }}
        alerts={{ overview: ws.suggestions.length + ws.upcoming.length > 0, inbox: ws.unread > 0, documents: ws.expiringDocuments.length > 0 }}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          id="candidate-tabpanel"
          role="tabpanel"
          aria-labelledby={`candidate-tab-${tab}`}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
        >
          {tab === "overview" ? <OverviewTab ws={ws} actions={actions} canAct={canAct} onNotify={setToast} /> : null}
          {tab === "applications" ? <ApplicationsTab ws={ws} actions={actions} canAct={canAct} onMove={moveApplication} /> : null}
          {tab === "inbox" ? <InboxTab ws={ws} actions={actions} canAct={canAct} selectedId={selectedMessageId} onSelect={openMessage} /> : null}
          {tab === "jobs" ? (
            <CandidateJobsTab
              candidate={candidate}
              jobs={ws.jobsQuery.data ?? []}
              favoriteJobIds={ws.favoriteJobIds}
              applications={ws.applications}
              isLoading={ws.jobsQuery.isLoading || ws.applicationsQuery.isLoading}
              isMatching={matchRun > matchDone}
              hasMatched={matchRun > 0}
              onMatchDone={finishMatch}
            />
          ) : null}
          {tab === "resumes" ? <ResumesTab candidate={candidate} resumes={resumes} isLoading={ws.resumesQuery.isLoading} error={ws.resumesQuery.error} onRetry={() => void ws.resumesQuery.refetch()} canAct={canAct} /> : null}
          {tab === "documents" ? <DocumentsTab ws={ws} canAct={canAct} onNotify={setToast} /> : null}
          {tab === "activity" ? <ActivityTab applications={ws.applications} messages={ws.messages} teamName={ws.teamName} onOpenApplication={setOpenApplicationId} /> : null}
        </motion.div>
      </AnimatePresence>

      <ApplicationDrawer ws={ws} applicationId={openApplicationId} canAct={canAct} onMove={moveApplication} onClose={closeDrawer} />
      <CandidateToast message={toast} />
    </div>
  );
}
