"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { can, canManageResume, canSearchJobs } from "@/lib/auth/permissions";
import { useJobSearches, useStartJobSearch } from "@/lib/hooks/use-jobs";
import { blockedReason, searchRole, type FindJobsSearch } from "@/components/app/candidate/find-jobs";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useUpdateApplicationStatus } from "@/lib/hooks/use-applications";
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
import { useCandidateWorkspace, type Suggestion } from "@/components/app/candidate/use-candidate-workspace";
import type { CandidateActions } from "@/components/app/candidate/candidate-actions";
import { OverviewTab } from "@/components/app/candidate/overview/overview-tab";
import { DocumentsTab } from "@/components/app/candidate/documents/documents-tab";
import { ApplicationsTab } from "@/components/app/candidate/applications/applications-tab";
import { ApplicationDrawer } from "@/components/app/candidate/applications/application-drawer";
import { InboxTab } from "@/components/app/candidate/inbox/inbox-tab";
import { ResumesTab } from "@/components/app/candidate/resumes-tab";
import { UploadResume } from "@/components/app/resumes/upload-resume";
import { ActivityTab } from "@/components/app/candidate/activity-tab";
import { STATUS_LABEL } from "@/components/app/applications/status-meta";
import { useHref } from "@/lib/routes/use-href";

export default function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const toHref = useHref();
  const { id } = use(params);
  const principal = useSignedInPrincipal();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = useSearchParams().get("tab");
  const tab: CandidateTabId = isCandidateTab(tabParam) ? tabParam : "overview";
  const reduce = useReducedMotion() ?? false;
  const ws = useCandidateWorkspace(id);
  const { access } = useRouteAccess();
  const updateStatus = useUpdateApplicationStatus();
  const canAct = can(principal, "candidate.edit");
  const canEditProfile = can(principal, "candidate.editProfile");
  // "Find jobs" is the candidate's BDE's (docs/02 §6.z); while their search runs, the matching sequence waits for it.
  const canSearch = ws.candidate ? canSearchJobs(principal, ws.candidate) : false;
  const searchesQuery = useJobSearches(id, canSearch);
  const isSearching = Boolean(searchesQuery.data?.running);
  const startSearch = useStartJobSearch(id);
  const role = ws.candidate ? searchRole(ws.candidate) : null;
  const searchBlocked = ws.candidate ? blockedReason(ws.candidate, searchesQuery.data) : null;

  const tabsRef = useRef<HTMLDivElement>(null);
  const [openApplicationId, setOpenApplicationId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
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
      router.replace(next === "overview" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
      requestAnimationFrame(() => {
        const bar = tabsRef.current;
        if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      });
    },
    [router, pathname, reduce],
  );

  const moveApplication = useCallback(
    (applicationId: string, to: ApplicationStatus, note: string | null = null) => {
      const app = ws.applications.find((a) => a.id === applicationId);
      updateStatus.mutate({ id: applicationId, status: to, note });
      setToast(`${app?.companyNameAtApply ?? "Application"} moved to ${STATUS_LABEL[to]}`);
    },
    [ws.applications, updateStatus],
  );

  // Every "Find jobs" on this page starts the candidate's search (their BDE only), then shows the Jobs tab. When it
  // can't start (no role, no country, today's limit, one running), the tab opens and the header says why.
  const { mutate: startMutate, isPending: isStartPending } = startSearch;
  const findJobs = useCallback(() => {
    if (role && !searchBlocked && !isSearching && !isStartPending) startMutate(role);
    setMatchRun((n) => n + 1);
    setTab("jobs");
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
  }, [role, searchBlocked, isSearching, isStartPending, startMutate, setTab, reduce]);

  const actions = useMemo<CandidateActions>(() => ({
    openTab: setTab,
    openApplication: setOpenApplicationId,
    openMessage: (messageId) => {
      setOpenApplicationId(null);
      setSelectedMessageId(messageId);
      setTab("inbox");
    },
    applySuggestion: (s: Suggestion) => moveApplication(s.applicationId, s.to, `From recruiter email: ${s.message.subject}`),
    findJobs: canSearch ? findJobs : undefined,
  }), [setTab, moveApplication, canSearch, findJobs]);
  const search: FindJobsSearch | undefined = canSearch
    ? { run: findJobs, isStarting: startSearch.isPending, refusal: startSearch.error instanceof Error ? startSearch.error.message : null }
    : undefined;

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

  return (
    <div className="bq-page">
      <CandidateHeader
        candidate={candidate}
        stats={ws.stats}
        ownerName={ws.ownerName}
        showOwner={can(principal, "team.view")}
        canAct={canAct}
        resumeHref={ws.base ? toHref("resumes.studio", { id: ws.base.version.id }) : null}
        search={search}
        onOpenTab={setTab}
      />

      <CandidateTabs
        ref={tabsRef}
        value={tab}
        onChange={setTab}
        counts={{ applications: ws.stats?.applicationsSubmitted, resumes: ws.resumes.length, documents: ws.documentsQuery.data?.length }}
        alerts={{ overview: ws.suggestions.length + ws.upcoming.length > 0, inbox: ws.unread > 0, documents: ws.expiringDocuments.length > 0 }}
        // Upload sits on the tab bar's line; with no résumé yet, the tab's empty state offers it instead.
        trailing={tab === "resumes" && canAct && canManageResume(principal, candidate) && (ws.shelfQuery.data?.bases.length ?? 0) > 0
          ? <UploadResume candidateId={candidate.id} /> : null}
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
          {tab === "overview" ? <OverviewTab ws={ws} actions={actions} canAct={canAct} canEditProfile={canEditProfile} onNotify={setToast} /> : null}
          {tab === "applications" ? <ApplicationsTab ws={ws} actions={actions} canAct={canAct} onMove={moveApplication} /> : null}
          {tab === "inbox" ? <InboxTab ws={ws} actions={actions} canAct={canAct} selectedId={selectedMessageId} onSelect={setSelectedMessageId} /> : null}
          {tab === "jobs" ? (
            <CandidateJobsTab
              candidate={candidate}
              jobs={ws.jobsQuery.data ?? []}
              applications={ws.applications}
              isLoading={ws.jobsQuery.isLoading || ws.applicationsQuery.isLoading}
              isMatching={matchRun > matchDone}
              isSearching={isSearching}
              hasMatched={matchRun > 0}
              onMatchDone={finishMatch}
            />
          ) : null}
          {tab === "resumes" ? <ResumesTab candidate={candidate} shelf={ws.shelfQuery.data} isLoading={ws.shelfQuery.isLoading} error={ws.shelfQuery.error} onRetry={() => void ws.shelfQuery.refetch()} canAct={canAct} /> : null}
          {tab === "documents" ? <DocumentsTab ws={ws} canAct={canAct} onNotify={setToast} /> : null}
          {tab === "activity" ? <ActivityTab applications={ws.applications} messages={ws.messages} teamName={ws.teamName} onOpenApplication={setOpenApplicationId} /> : null}
        </motion.div>
      </AnimatePresence>

      <ApplicationDrawer ws={ws} applicationId={openApplicationId} canAct={canAct} actions={actions} onMove={moveApplication} onClose={closeDrawer} />
      <CandidateToast message={toast} />
    </div>
  );
}
