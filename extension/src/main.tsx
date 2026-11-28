import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Application,
  applicationUrl,
  BENCHQ_URL,
  Candidate,
  candidateResumesUrl,
  getCandidates,
  getSavedApplications,
  getSession,
  isSessionExpired,
  markApplied,
  Session,
  signOut,
} from "./api";
import { CHECK, PIN_ICON, USER_ICON } from "./autofill/icons";
import { payText } from "./autofill/job-details";
import SettingsDrawer, { initialsOf } from "./SettingsDrawer";
import AutofillPanel from "./autofill/AutofillPanel";
import AppliedPage from "./autofill/AppliedPage";
import type { ApplicationContextStatus } from "./autofill/use-resumes";
import { connectionFor, sendToBackground } from "./autofill/connection-store";
import { forgetForm } from "./autofill/form-memory";
import {
  hasAutofillPermissions,
  reloadIfManifestIsStale,
} from "./autofill/manifest-check";
import { forgetTabs } from "./autofill/use-autofill";
import { forgetPostings } from "./autofill/use-posting";
import AddJobCard, { forgetJobDrafts } from "./autofill/AddJobCard";
import { useTabConnection } from "./autofill/use-tab-connection";
import type { AppliedForm } from "./autofill/types";
import JobTabs, { JOB_PANEL, tabId, type JobTab } from "./JobTabs";
import { CompanyLogo } from "./autofill/CompanyLogo";
import { PREVIEW_KEY } from "./frame-rules";
import "./style.css";
import { answerPanelWindow } from "./panel-window";
import {
  ALERT,
  button,
  CARD,
  ICON_BUTTON_QUIET,
  MOTION,
  MUTED_TEXT,
  SKELETON_LINE,
  SOFT_TEXT,
  TEXT_BUTTON,
} from "./ui";

const OPEN_JOB = (
  <>
    <span>Open job</span>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 4h6v6m-1-5-9 9" />
      <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </svg>
  </>
);

/** The white workspace: a column the panel's height that never scrolls as a whole (Simplify's layout). Its top bar
 * stays put, and only the job list or the connected job's fields scroll inside it. */
const WORKSPACE =
  "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]";
const TOPBAR =
  "flex min-h-[var(--topbar-height)] flex-none items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2";
/** Under the top bar, at the panel's height. A panel too short for its fixed parts scrolls them rather than cut any off. */
const VIEW = "relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 [scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin]";
/** The one part of the job list that scrolls: the jobs, under the fixed account, candidate and tabs. */
const LIST = "relative -mx-3 min-h-32 flex-1 overflow-y-auto overscroll-contain px-3 pt-0.5 pb-3 [scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin]";
const CANDIDATE_SELECT = `h-[var(--control-lg)] w-full appearance-none rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] bg-[image:var(--gradient-neutral)] pr-[var(--control-sm)] text-sm font-[550] text-[var(--color-text)] shadow-[var(--shadow-control)] transition-[border-color,background] ${MOTION} enabled:hover:border-[var(--color-text-3)] enabled:hover:bg-[image:var(--gradient-neutral-hover)] focus-visible:border-[var(--color-focus-ring)] focus-visible:shadow-[var(--ring-input)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[var(--color-surface-2)] disabled:bg-none disabled:text-[var(--color-text-3)] disabled:shadow-none [&_option]:bg-[var(--color-surface)] [&_option]:text-[var(--color-text)]`;
const CANDIDATE_LOCK = "candidate-lock";
/** The candidate's initials inside the dropdown, on the page that adds a job for them. */
const CANDIDATE_AVATAR = "pointer-events-none absolute top-1/2 left-2 grid size-5 -translate-y-1/2 place-items-center rounded-full bg-[var(--color-primary-subtle)] text-caption font-[700] text-[var(--color-primary-subtle-fg)]";
/** A saved or applied job: its logo, what it is and where, its facts as badges, and Open job across the foot. */
const JOB_CARD = `min-w-0 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-xs)] transition-[border-color,box-shadow,transform] ${MOTION} hover:-translate-y-px hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-sm)] motion-reduce:hover:translate-y-0`;
const BADGE = "rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-caption font-[550] text-[var(--color-text-2)]";
const APPLIED_BADGE = "inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-success-fg)_35%,transparent)] bg-[var(--color-success-bg)] px-2 py-0.5 text-caption font-[650] text-[var(--color-success-fg)] [&_svg]:size-3 [&_svg]:flex-none";
/** Open job, across the foot of a job card. */
const OPEN_JOB_BUTTON = `${button("secondary", "small")} w-full`;
/** A label over a control, as the design's: small capitals, wide spacing. */
const FIELD_LABEL = "text-caption font-[700] uppercase tracking-widest text-[var(--color-text-3)]";

/** What a job card says besides its title, company and place: its type, how it's done, and its pay. */
function badgesOf(job: Application): string[] {
  const mode = job.arr_remote || job.remote ? "Remote" : job.arr_hybrid ? "Hybrid" : job.arr_onsite ? "On-site" : job.work_type ?? "";
  return [job.employment_type ?? job.job_type ?? "", mode, payText(job.salary_min, job.salary_max) ?? ""].filter(Boolean);
}
/** The panel opened as a tab of its own: the background answers only Chrome's side panel, so say how to get there. */
const PANEL_IN_A_TAB = "BenchQ runs in Chrome's side panel. Go to the job's tab and click the BenchQ icon in the toolbar.";

async function isInATab(): Promise<boolean> {
  try {
    return Boolean(await chrome.tabs.getCurrent?.());
  } catch {
    return false;
  }
}
const TOOLTIP = `invisible absolute inset-x-0 top-full z-10 mt-1 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-caption text-[var(--color-text-2)] opacity-0 shadow-[var(--shadow-sm)] transition-[opacity,visibility] ${MOTION} group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100`;
const NOTICE = `mt-3 p-3 ${CARD}`;
const NOTICE_TITLE = "mb-1 text-h3";
const NOTICE_TEXT = `mb-2.5 ${SOFT_TEXT}`;

const isConnectable = (job: Application) =>
  job.status === "saved" &&
  Boolean(job.url && job.candidate_id) &&
  hasAutofillPermissions();

/** A card that holds the place of a job while the list loads. */
const SKELETON_CARD = "grid gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3";

function App() {
  const [session, setSession] = useState<Session | null>(null);
  // "Posting preview": LinkedIn postings shown inside BenchQ (frame-rules.ts). On unless turned off.
  const [isPreviewOn, setPreviewOn] = useState(true);
  useEffect(() => {
    void chrome.storage.sync.get([PREVIEW_KEY]).then((stored) => setPreviewOn(stored[PREVIEW_KEY] !== false));
  }, []);
  const togglePreview = () => {
    const next = !isPreviewOn;
    setPreviewOn(next);
    void chrome.storage.sync.set({ [PREVIEW_KEY]: next });
  };
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState(
    () => localStorage.getItem("benchq-selected-candidate") || "",
  );
  const [jobs, setJobs] = useState<Application[]>([]);
  const showPageTitle = useCallback((id: string, title: string) => {
    setJobs(current => current.map(job => job.id === id ? { ...job, title } : job));
  }, []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [appliedResult, setAppliedResult] = useState<{ job: Application; tabId: number; userId: string } | null>(null);
  const sessionGeneration = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [watchingLogin, setWatchingLogin] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("benchq-theme") === "dark" ? "dark" : "light",
  );
  const [activeTab, setActiveTab] = useState<JobTab>("saved");
  // The account and settings drawer, and the button it opens from (focus goes back there).
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const userButton = useRef<HTMLButtonElement>(null);
  // A job's page in the tab: the panel is the page that adds it, the candidate and the job alone, no Saved or Applied.
  const [isAddJobShown, setIsAddJobShown] = useState(false);
  // Add job's page for the job's details: the panel is that page, with no candidate picker over it.
  const [isAddJobDetailsShown, setIsAddJobDetailsShown] = useState(false);
  const savedJobs = jobs.filter((job) => job.status === "saved");
  const appliedJobs = jobs.filter((job) => job.status === "applied");
  const visibleJobs = activeTab === "saved" ? savedJobs : appliedJobs;
  const { tab: activeBrowserTab, connection } = useTabConnection(session?.principal.user_id ?? null);
  const appliedHere = appliedResult?.userId === session?.principal.user_id && appliedResult?.tabId === activeBrowserTab?.id
    && (!connection || connection.applicationId === appliedResult?.job.id) ? appliedResult : null;
  // The tab the BDE is on now, for an add that finishes after they moved on (Q10).
  const latestTab = useRef(activeBrowserTab);
  useEffect(() => { latestTab.current = activeBrowserTab; }, [activeBrowserTab]);
  const tabCandidateId = connection?.candidateId ?? null;
  const linkedJob =
    jobs.find((job) => job.id === connection?.applicationId && job.candidate_id === connection?.candidateId) ?? null;
  const applicationStatus: ApplicationContextStatus = !connection || loading || loadingJobs || selectedCandidateId !== connection.candidateId
    ? "loading"
    : linkedJob ? "ready" : "unavailable";
  // Why the dropdown can't be changed. A disabled control takes no focus, so its wrapper does, for the keyboard.
  const candidateLock = connection
    ? "Locked to the linked job's candidate. Click ✕ on the job to change it."
    : candidates.length === 0
      ? "No candidates are assigned to you yet."
      : "";
  const lockDetails = candidateLock
    ? {
        role: "group",
        tabIndex: 0,
        "aria-label": "Candidate dropdown",
        "aria-describedby": CANDIDATE_LOCK,
      }
    : {};
  const latestJobsLoad = useRef(0);
  const expireSession = useCallback(() => {
    sessionGeneration.current += 1;
    latestJobsLoad.current += 1;
    setLoading(false);
    setLoadingJobs(false);
    setSession(null);
    setCandidates([]);
    setSelectedCandidateId("");
    setJobs([]);
    setAppliedResult(null);
    forgetJobDrafts();
    localStorage.removeItem("benchq-selected-candidate");
    forgetTabs();
    forgetPostings();
    setError("Your BenchQ session ended. Sign in again.");
    void sendToBackground({ type: "clear-connections" });
  }, []);
  /** Sign out from the settings drawer: the session ends in BenchQ, and the panel forgets it as it does an expired one. */
  const signOutNow = async () => {
    setIsSettingsOpen(false);
    try {
      await signOut();
    } catch (error) {
      if (!isSessionExpired(error)) {
        setError("Could not sign out. Try again.");
        return;
      }
    }
    expireSession();
    setError("");
  };
  const closeSettings = () => {
    setIsSettingsOpen(false);
    userButton.current?.focus();
  };
  const connectedTabId = connection?.tabId ?? null;
  const connectedJobId = connection?.applicationId ?? null;
  const disconnectTab = useCallback(() => {
    if (connectedTabId !== null)
      void sendToBackground({ type: "disconnect-tab", tabId: connectedTabId });
    if (connectedJobId !== null) forgetForm(connectedJobId);
  }, [connectedTabId, connectedJobId]);
  const candidateAccessLost = useCallback(() => {
    disconnectTab();
    setError(
      "You no longer have access to this candidate, so the tab was disconnected.",
    );
  }, [disconnectTab]);
  // The latest load wins: switching tabs can overtake one still on its way, and that one's result or failure no longer counts.
  const loadJobs = useCallback(async (candidateId: string) => {
    latestJobsLoad.current += 1;
    const load = latestJobsLoad.current;
    setLoadingJobs(true);
    try {
      const found = await getSavedApplications(candidateId);
      if (load === latestJobsLoad.current) setJobs(found);
    } catch (e) {
      if (load === latestJobsLoad.current) throw e;
    } finally {
      if (load === latestJobsLoad.current) setLoadingJobs(false);
    }
  }, []);
  const refresh = useCallback(async () => {
    const generation = sessionGeneration.current;
    setLoading(true);
    setError("");
    setJobs([]);
    try {
      const current = await getSession();
      if (generation !== sessionGeneration.current) return;
      setSession(current);
      if (
        current.principal.kind !== "firm" ||
        current.principal.role !== "BDE" ||
        !current.principal.firm_id
      ) {
        setCandidates([]);
        setSelectedCandidateId("");
        setJobs([]);
        return;
      }
      const assignedCandidates = (
        await getCandidates(current.principal.firm_id)
      ).sort((left, right) => left.full_name.localeCompare(right.full_name));
      if (generation !== sessionGeneration.current) return;
      setCandidates(assignedCandidates);
      const storedCandidateId =
        localStorage.getItem("benchq-selected-candidate") || "";
      const candidateId = assignedCandidates.some(
        (candidate) => candidate.id === storedCandidateId,
      )
        ? storedCandidateId
        : assignedCandidates[0]?.id || "";
      setSelectedCandidateId(candidateId);
      if (candidateId) {
        localStorage.setItem("benchq-selected-candidate", candidateId);
        await loadJobs(candidateId);
      } else {
        localStorage.removeItem("benchq-selected-candidate");
        setJobs([]);
      }
    } catch (e) {
      if (generation !== sessionGeneration.current) return;
      setSession(null);
      setCandidates([]);
      setSelectedCandidateId("");
      setJobs([]);
      setError(
        isSessionExpired(e)
          ? "Your BenchQ session expired. Sign in and retry."
          : "Could not reach BenchQ. Check the app connection and retry.",
      );
    } finally {
      if (generation === sessionGeneration.current) setLoading(false);
    }
  }, [loadJobs]);
  const chooseCandidate = useCallback(
    async (candidateId: string) => {
      setSelectedCandidateId(candidateId);
      localStorage.setItem("benchq-selected-candidate", candidateId);
      setActiveTab("saved");
      setError("");
      setJobs([]);
      try {
        await loadJobs(candidateId);
      } catch (e) {
        setJobs([]);
        if (isSessionExpired(e)) expireSession();
        else
          setError(
            "Could not load this candidate’s jobs. Refresh and try again.",
          );
      }
    },
    [expireSession, loadJobs],
  );
  useEffect(() => {
    // Preserve the existing mount-time session and job refresh behavior.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  // A connected tab decides whose jobs these are. The dropdown stays on that candidate when the connection ends.
  useEffect(() => {
    if (!tabCandidateId || tabCandidateId === selectedCandidateId) return;
    if (!candidates.some(({ id }) => id === tabCandidateId)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void chooseCandidate(tabCandidateId);
  }, [tabCandidateId, selectedCandidateId, candidates, chooseCandidate]);
  // The website can save the job after this list loaded (Open source does both at once): load it again, once per job.
  const reloadedFor = useRef<string | null>(null);
  const isLinkedJobMissing = Boolean(connectedJobId) && !loading && !loadingJobs && !linkedJob && selectedCandidateId === tabCandidateId;
  useEffect(() => {
    if (!isLinkedJobMissing || !tabCandidateId || reloadedFor.current === connectedJobId) return;
    reloadedFor.current = connectedJobId;
    void loadJobs(tabCandidateId).catch(() => undefined);
  }, [isLinkedJobMissing, tabCandidateId, connectedJobId, loadJobs]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    let checking = false;
    const checkSession = async () => {
      if (!active || checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const current = await getSession();
        if (
          current.principal.user_id !== session.principal.user_id ||
          current.principal.kind !== session.principal.kind ||
          current.principal.role !== session.principal.role ||
          current.principal.firm_id !== session.principal.firm_id
        ) {
          await refresh();
        }
      } catch (e) {
        if (active && isSessionExpired(e)) expireSession();
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => {
      void checkSession();
    }, 15000);
    window.addEventListener("focus", checkSession);
    document.addEventListener("visibilitychange", checkSession);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", checkSession);
      document.removeEventListener("visibilitychange", checkSession);
    };
  }, [session, refresh, expireSession]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("benchq-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!watchingLogin || session) return;
    const timer = window.setInterval(() => {
      void getSession()
        .then(() => {
          setWatchingLogin(false);
          void refresh();
        })
        .catch(() => undefined);
    }, 2500);
    const stop = window.setTimeout(() => setWatchingLogin(false), 120000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [watchingLogin, session, refresh]);
  const login = () => {
    setWatchingLogin(true);
    void chrome.tabs.create({ url: `${BENCHQ_URL}/sign-in` });
  };
  const openJob = async (job: Application) => {
    setError("");
    const details = session && connectionFor(job, session.principal.user_id);
    if (!details) return;
    const reply = await sendToBackground({
      type: "open-job",
      connection: details,
    }).catch(() => null);
    if (!reply?.ok) setError(await isInATab() ? PANEL_IN_A_TAB : "Could not open this job. Try again.");
  };
  const apply = async (job: Application, form: AppliedForm, resumeId: string | null) => {
    const generation = sessionGeneration.current;
    const submittedFrom = connection;
    setBusy(job.id);
    setError("");
    try {
      const updated = await markApplied(job, form, resumeId);
      if (generation !== sessionGeneration.current) return;
      setJobs((all) =>
        all.map((item) =>
          item.id === job.id
            ? {
                ...item,
                status: updated.status,
                status_revision: updated.status_revision,
                status_transitions: updated.status_transitions,
              }
            : item,
        ),
      );
      setActiveTab("applied");
      if (submittedFrom) setAppliedResult({ job, tabId: submittedFrom.tabId, userId: submittedFrom.userId });
      // The job is done: the tab stays open on the page, but nothing is left to fill.
      forgetForm(job.id);
      void sendToBackground({ type: "disconnect-job", applicationId: job.id });
    } catch (e) {
      if (generation !== sessionGeneration.current) return;
      if (isSessionExpired(e)) expireSession();
      else
        setError("Could not update this application. Refresh and try again.");
    } finally {
      setBusy(null);
    }
  };
  // A job BenchQ can connect opens in a connected tab, and the panel scans it. If it's open already, this goes to its tab.
  const connectThisTab = async (job: Application) => {
    setError("");
    const details = session && connectionFor(job, session.principal.user_id);
    if (!details || !activeBrowserTab) return;
    const reply = await sendToBackground({ type: "connect-tab", connection: details, tabId: activeBrowserTab.id }).catch(() => null);
    if (!reply?.ok) setError(await isInATab() ? PANEL_IN_A_TAB : "Could not use this tab. Try Open job.");
  };
  const openJobLink = (job: Application) => {
    if (isConnectable(job)) {
      return (
        <button
          type="button"
          className={OPEN_JOB_BUTTON}
          onClick={() => void openJob(job)}
        >
          {OPEN_JOB}
        </button>
      );
    }
    if (job.url) {
      return (
        <a
          className={OPEN_JOB_BUTTON}
          href={job.url}
          target="_blank"
          rel="noreferrer"
        >
          {OPEN_JOB}
        </a>
      );
    }
    return (
      <button type="button" className={OPEN_JOB_BUTTON} disabled>
        {OPEN_JOB}
      </button>
    );
  };
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null;
  const selectedCandidateName = selectedCandidate?.full_name ?? "";
  // A job on the page the BDE is looking at, not yet one of the candidate's: added and Saved, then this tab connects, as
  // the BDE is already on the form (Q10), with no tab of its own.
  const addJobCard = !connection && selectedCandidate && !loadingJobs ? (
    <AddJobCard key={`${session?.principal.user_id ?? ""}:${selectedCandidate.id}:${activeBrowserTab?.id ?? ""}:${activeBrowserTab?.url ?? ""}`} tab={activeBrowserTab} firmId={session?.principal.firm_id ?? null} userId={session?.principal.user_id} candidateId={selectedCandidate.id}
      candidateName={selectedCandidate.full_name} knownUrls={jobs.flatMap((job) => (job.url ? [job.url] : []))} knownJobs={jobs}
      onPageTitle={showPageTitle} onShown={setIsAddJobShown} onDetailsShown={setIsAddJobDetailsShown}
      onUseTab={(known) => { const job = jobs.find(({ id }) => id === known.id); if (job?.status === "saved") void connectThisTab(job); }}
      onAdded={(application) => {
        loadJobs(selectedCandidate.id).catch(() => undefined);
        // This tab, while it still shows the page the job was added from; if it moved on meanwhile, the job opens in
        // a tab of its own, so no other page is connected to it.
        const now = latestTab.current;
        const isSamePage = Boolean(now && activeBrowserTab && now.id === activeBrowserTab.id && now.url === activeBrowserTab.url);
        void (isSamePage ? connectThisTab(application) : openJob(application));
      }} />
  ) : null;
  const jobsArea = (
    <>
      {addJobCard}
      {/* On a job's page the panel adds that job: the candidate and the job alone, no Saved or Applied under them. */}
      {!(isAddJobShown && addJobCard) && <>
      <JobTabs
        active={activeTab}
        counts={
          loadingJobs
            ? null
            : { saved: savedJobs.length, applied: appliedJobs.length }
        }
        onChange={setActiveTab}
      />
      <div id={JOB_PANEL} role="tabpanel" aria-labelledby={tabId(activeTab)} className={LIST}>
        {loadingJobs ? (
          <div className="grid gap-2" role="status" aria-label="Loading jobs">
            {[0, 1, 2].map((index) => <div key={index} className={SKELETON_CARD} aria-hidden="true">
              <div className={`${SKELETON_LINE} w-1/2`} />
              <div className={`${SKELETON_LINE} w-1/3`} />
            </div>)}
            <span className="sr-only">Loading jobs…</span>
          </div>
        ) : visibleJobs.length === 0 ? (
          <section data-slot="empty" className={NOTICE}>
            <h2 className={NOTICE_TITLE}>No {activeTab} jobs</h2>
            <p className={NOTICE_TEXT}>
              {activeTab === "saved"
                ? "Saved jobs for candidates assigned to you will appear here."
                : "Jobs you apply to will appear here."}
            </p>
          </section>
        ) : (
          <section className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-label={`${activeTab} jobs`}>
            {visibleJobs.map((job) => {
              const badges = badgesOf(job);
              return <article data-slot="job" className={JOB_CARD} key={job.id}>
                <div className="flex min-w-0 items-start gap-3">
                  <CompanyLogo company={job.company || job.title || "Job"} url={job.logoUrl} size="lg" />
                  <div className="grid min-w-0 flex-1">
                    <h2 className="truncate text-sm font-[650] leading-snug" title={job.title || undefined}>
                      {isConnectable(job) ? (
                        <button
                          type="button"
                          data-slot="job-select"
                          className="max-w-full truncate text-left hover:text-[var(--color-primary)]"
                          onClick={() => void openJob(job)}
                        >
                          {job.title || "Untitled role"}
                        </button>
                      ) : (
                        job.title || "Untitled role"
                      )}
                    </h2>
                    <p className="truncate text-caption text-[var(--color-text-2)]">{job.company || "Company not listed"}</p>
                    <p className="mt-1 flex min-w-0 items-center gap-1 text-caption text-[var(--color-text-3)] [&_svg]:size-3 [&_svg]:flex-none" title={job.location || undefined}>
                      {PIN_ICON}<span className="truncate">{job.location || "Location not listed"}</span>
                    </p>
                  </div>
                </div>
                {(badges.length > 0 || job.status === "applied") && <ul data-slot="job-badges" className="mt-3 flex flex-wrap gap-1.5">
                  {job.status === "applied" && <li className={APPLIED_BADGE}>{CHECK}Applied</li>}
                  {badges.map((badge) => <li key={badge} className={BADGE}>{badge}</li>)}
                </ul>}
                <div className="mt-3 grid">{openJobLink(job)}</div>
              </article>;
            })}
          </section>
        )}
      </div>
      </>}
    </>
  );
  return (
    <main className={WORKSPACE}>
      <header className={TOPBAR}>
        <div className="flex min-w-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="block size-8 shrink-0 rounded-[var(--radius-lg)] object-cover shadow-[var(--shadow-sm)]"
            src="/icons/icon128.png"
            alt=""
          />
          <span className="whitespace-nowrap text-h3 font-[700] tracking-tight">BenchQ</span>
        </div>
        <div className="flex min-w-0 flex-none items-center gap-1">
          <button
            className={ICON_BUTTON_QUIET}
            onClick={() =>
              setTheme((current) => (current === "light" ? "dark" : "light"))
            }
            aria-label={
              theme === "light"
                ? "Switch to dark theme"
                : "Switch to light theme"
            }
            title={
              theme === "light"
                ? "Switch to dark theme"
                : "Switch to light theme"
            }
          >
            {theme === "light" ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6.9 6.9 0 0 0 8.268 8.268c.344-.215.825-.003.803.401" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
              </svg>
            )}
          </button>
          <button
            className={ICON_BUTTON_QUIET}
            onClick={() => void refresh()}
            aria-label="Refresh saved jobs"
            title="Refresh saved jobs"
          >
            {/* One circular arrow (rotate-cw): lighter than the two-arrow refresh. */}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
          {session && <button
            ref={userButton}
            type="button"
            data-slot="settings-open"
            className={ICON_BUTTON_QUIET}
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Account and settings"
            aria-haspopup="dialog"
            aria-expanded={isSettingsOpen}
            title={`${session.user?.name || "BDE"} · Settings`}
          >
            {USER_ICON}
          </button>}
        </div>
      </header>
      {session && <SettingsDrawer isOpen={isSettingsOpen} session={session} isPreviewOn={isPreviewOn} isDark={theme === "dark"}
        onTogglePreview={togglePreview} onToggleTheme={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
        onSignOut={() => void signOutNow()} onClose={closeSettings} />}
      <div className={VIEW}>
      {loading ? (
        <p className={`my-3 ${MUTED_TEXT}`}>Checking your BenchQ session…</p>
      ) : !session ? (
        <section className={NOTICE}>
          <h1 className={NOTICE_TITLE}>Sign in to BenchQ</h1>
          <p className={NOTICE_TEXT}>
            {error || "Connect your BenchQ account to view your saved jobs."}
          </p>
          <button className={button("primary")} onClick={login}>
            Login
          </button>
          <button className={TEXT_BUTTON} onClick={() => void refresh()}>
            I’m signed in · Retry
          </button>
        </section>
      ) : session.principal.kind !== "firm" ||
        session.principal.role !== "BDE" ? (
        <section className={NOTICE}>
          <h1 className={NOTICE_TITLE}>BDE account required</h1>
          <p className={NOTICE_TEXT}>
            This extension is designed for BDE users to quickly access their
            favourite jobs and track applications. Please log in with a BDE
            account to use it.
          </p>
        </section>
      ) : (
        <>
          {/* Who's signed in is in the settings drawer (the user button in the top bar). */}
          <h1 className="sr-only">BenchQ for {session.user?.name || "BDE"}</h1>
          {error && (
            <p data-slot="error" className={`mb-2.5 ${ALERT}`}>
              {error}
            </p>
          )}
          {!hasAutofillPermissions() && (
            <p data-slot="error" className={`mb-2.5 ${ALERT}`}>
              Autofill is off because Chrome hasn&apos;t reloaded this
              extension. Open chrome://extensions and click Reload on BenchQ Autofill
              Apply.
            </p>
          )}
          {!connection && !appliedHere && !(isAddJobDetailsShown && addJobCard) && <div className="mt-3 mb-3 grid gap-1.5">
            <label
              className={FIELD_LABEL}
              htmlFor="candidate-select"
            >
              {isAddJobShown ? "Add job for" : "Show jobs for"}
            </label>
            <div className="group relative" {...lockDetails}>
              {isAddJobShown && selectedCandidateName && <span className={CANDIDATE_AVATAR} aria-hidden="true">{initialsOf(selectedCandidateName)}</span>}
              <select
                id="candidate-select"
                className={`${CANDIDATE_SELECT} ${isAddJobShown && selectedCandidateName ? "pl-9" : "pl-3"}`}
                value={selectedCandidateId}
                disabled={loading || Boolean(candidateLock)}
                onChange={(event) => void chooseCandidate(event.target.value)}
              >
                {candidates.length === 0 ? (
                  <option value="">No assigned candidates</option>
                ) : (
                  candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.full_name}
                    </option>
                  ))
                )}
              </select>
              <svg
                className="pointer-events-none absolute top-1/2 right-2.5 size-[var(--icon-sm)] -translate-y-1/2 text-[var(--color-text-3)]"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              {candidateLock && (
                <span id={CANDIDATE_LOCK} role="tooltip" className={TOOLTIP}>
                  {candidateLock}
                </span>
              )}
            </div>
          </div>}
          {appliedHere ? (
            <AppliedPage title={appliedHere.job.title || "Untitled role"} company={appliedHere.job.company ?? ""} logoUrl={appliedHere.job.logoUrl}
              candidateName={candidates.find(({ id }) => id === appliedHere.job.candidate_id)?.full_name ?? "this candidate"}
              viewUrl={session.firm?.slug ? applicationUrl(session.firm.slug, appliedHere.job.id) : null}
              onBack={() => { setAppliedResult(null); if (connection) disconnectTab(); }} />
          ) : connection ? (
            <AutofillPanel
              // One panel per tab and job: a tab connected to another job starts afresh (its own form memory, next pages
              // off until the BDE runs Autofill for that job).
              key={`${connection.tabId}:${connection.applicationId}`}
              connection={connection}
              tabUrl={activeBrowserTab?.id === connection.tabId ? activeBrowserTab.url : null}
              applicationStatus={applicationStatus}
              onRetryContext={() => void refresh()}
              firmId={session.principal.firm_id ?? null}
              firmSlug={session.firm?.slug ?? null}
              details={linkedJob}
              resumesUrl={
                session.firm?.slug
                  ? candidateResumesUrl(session.firm.slug, connection.candidateId)
                  : null
              }
              candidateName={
                candidates.find(
                  (candidate) => candidate.id === connection.candidateId,
                )?.full_name ?? "this candidate"
              }
              applying={busy === connection.applicationId}
              isApplied={linkedJob?.status === "applied"}
              onApply={
                linkedJob?.status === "saved"
                  ? (form, resumeId) => void apply(linkedJob, form, resumeId)
                  : undefined
              }
              onDisconnect={disconnectTab}
              onSessionExpired={expireSession}
              onAccessLost={candidateAccessLost}
            />
          ) : (
            jobsArea
          )}
        </>
      )}
      </div>
    </main>
  );
}

reloadIfManifestIsStale();
answerPanelWindow();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
