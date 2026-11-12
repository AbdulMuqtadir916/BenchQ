"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import { can, canSearchJobs } from "@/lib/auth/permissions";
import { useJobSearches, useStartJobSearch } from "@/lib/hooks/use-jobs";
import { blockedReason, searchRole, type FindJobsSearch } from "@/components/app/candidate/find-jobs";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { moveFailure, useUpdateApplicationStatus } from "@/lib/hooks/use-applications";
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
import { ActivityTab } from "@/components/app/candidate/activity-tab";
import { STATUS_LABEL } from "@/components/app/applications/status-meta";
import { safeReturnTo } from "@/lib/routes/landing";
import { useHref } from "@/lib/routes/use-href";
import { BACK_SHORTCUT } from "@/lib/list-shortcuts";
import { usePageShortcuts } from "@/lib/hooks/use-page-shortcuts";
import { useEscapeBack } from "@/lib/hooks/use-escape-back";

export default function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const toHref = useHref();
  const { id } = use(params);
  const principal = useSignedInPrincipal();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const listHref = toHref("candidates");
  const requestedReturn = safeReturnTo(searchParams.get("returnTo"));
  const returnTo = requestedReturn?.split(/[?#]/)[0] === listHref ? requestedReturn : null;
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

  // Esc goes back (docs/04 §1.3, BUG-004): to where the person came from, which keeps the list's page, search and sort in its
  // URL, or to the candidates list when this page was opened directly. A drawer, dialog or field keeps its own Esc.
  const leave = useCallback(() => {
    router.replace(returnTo ?? listHref);
  }, [router, returnTo, listHref]);
  useEscapeBack(leave);
  usePageShortcuts(BACK_SHORTCUT);

  const tabsRef = useRef<HTMLDivElement>(null);
  const [openApplicationId, setOpenApplicationId] = useState<string | null>(null);
  // `?message=` opens one email, e.g. from an application's timeline (Abdul's review on #127).
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(() => searchParams.get("message"));
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
      const query = new URLSearchParams();
      if (next !== "overview") query.set("tab", next);
      if (returnTo) query.set("returnTo", returnTo);
      router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false });
      requestAnimationFrame(() => {
        const bar = tabsRef.current;
        if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      });
    },
    [router, pathname, reduce, returnTo],
  );

  const moveApplication = useCallback(
    (applicationId: string, to: ApplicationStatus, note: string | null = null) => {
      const name = ws.applications.find((a) => a.id === applicationId)?.companyNameAtApply || "Application";
      // Said once the server has the move; a failed move snaps back and says why instead.
      const started = updateStatus.mutate({ id: applicationId, status: to, note }, {
        onSuccess: () => setToast(`${name} moved to ${STATUS_LABEL[to]}`),
        onError: (error) => setToast(`${name} didn't move to ${STATUS_LABEL[to]}: ${moveFailure(error)}`),
      });
      if (!started) {
        setToast("Saving… wait for the current move of this application to finish.");
        return false;
      }
      return true;
    },
    [ws.applications, updateStatus],
  );

  // Every "Find jobs" on this page starts the candidate's search (their BDE only), then shows the Jobs tab. When it
  // can't start (no role, no country, today's limit, one running), the tab opens and the header says why.
  const { mutate: startMutate, isPending: isStartPending } = startSearch;
  const findJobs = useCallback(() => {
    // The matching sequence plays only for a search that starts, and stops if the backend refuses it; otherwise the
    // Jobs tab just opens and the header says why (CodeRabbit on #135).
    if (role && !searchBlocked && !isSearching && !isStartPending) {
      let run = 0;
      setMatchRun((n) => (run = n + 1));
      startMutate(role, { onError: () => setMatchDone((done) => Math.max(done, run)) });
    }
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
              error={ws.jobsQuery.error}
              onRetry={() => void ws.jobsQuery.refetch()}
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
