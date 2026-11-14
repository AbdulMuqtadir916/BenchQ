import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Application,
  BENCHQ_URL,
  Candidate,
  candidateResumesUrl,
  getCandidates,
  getSavedApplications,
  getSession,
  isSessionExpired,
  markApplied,
  Session,
} from "./api";
import AutofillPanel from "./autofill/AutofillPanel";
import type { ApplicationContextStatus } from "./autofill/use-resumes";
import { connectionFor, sendToBackground } from "./autofill/connection-store";
import { forgetForm } from "./autofill/form-memory";
import {
  hasAutofillPermissions,
  reloadIfManifestIsStale,
} from "./autofill/manifest-check";
import { forgetTabs } from "./autofill/use-autofill";
import AddJobCard from "./autofill/AddJobCard";
import { useTabConnection } from "./autofill/use-tab-connection";
import type { AppliedForm } from "./autofill/types";
import JobTabs, { JOB_PANEL, tabId, type JobTab } from "./JobTabs";
import "./style.css";
import {
  ALERT,
  button,
  CARD,
  EYEBROW,
  ICON_BUTTON_RAISED,
  MOTION,
  MUTED_TEXT,
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

/** The white workspace: the frame around it stays put and this scrolls inside it, as on the website. */
const WORKSPACE =
  "min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 pb-3 shadow-[var(--shadow-sm)] [scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin]";
const TOPBAR =
  "sticky top-0 z-2 -mx-3 flex min-h-[var(--topbar-height)] items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2";
const CANDIDATE_SELECT = `h-[var(--control-height)] w-full appearance-none rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] bg-[image:var(--gradient-neutral)] pr-[var(--control-sm)] pl-2.5 text-sm text-[var(--color-text)] shadow-[var(--shadow-control)] transition-[border-color,background] ${MOTION} enabled:hover:border-[var(--color-text-3)] enabled:hover:bg-[image:var(--gradient-neutral-hover)] focus-visible:border-[var(--color-focus-ring)] focus-visible:shadow-[var(--ring-input)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[var(--color-surface-2)] disabled:bg-none disabled:text-[var(--color-text-3)] disabled:shadow-none [&_option]:bg-[var(--color-surface)] [&_option]:text-[var(--color-text)]`;
const CANDIDATE_LOCK = "candidate-lock";
const TOOLTIP = `invisible absolute inset-x-0 top-full z-10 mt-1 rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-caption text-[var(--color-text-2)] opacity-0 shadow-[var(--shadow-sm)] transition-[opacity,visibility] ${MOTION} group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100`;
const NOTICE = `mt-3 p-3 ${CARD}`;
const NOTICE_TITLE = "mb-1 text-h3";
const NOTICE_TEXT = `mb-2.5 ${SOFT_TEXT}`;

const isConnectable = (job: Application) =>
  job.status === "saved" &&
  Boolean(job.url && job.candidate_id) &&
  hasAutofillPermissions();

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState(
    () => localStorage.getItem("benchq-selected-candidate") || "",
  );
  const [jobs, setJobs] = useState<Application[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [watchingLogin, setWatchingLogin] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("benchq-theme") === "dark" ? "dark" : "light",
  );
  const [activeTab, setActiveTab] = useState<JobTab>("saved");
  const savedJobs = jobs.filter((job) => job.status === "saved");
  const appliedJobs = jobs.filter((job) => job.status === "applied");
  const visibleJobs = activeTab === "saved" ? savedJobs : appliedJobs;
  const { tab: activeBrowserTab, connection } = useTabConnection(session?.principal.user_id ?? null);
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
    setSession(null);
    setCandidates([]);
    setSelectedCandidateId("");
    setJobs([]);
    localStorage.removeItem("benchq-selected-candidate");
    forgetTabs();
    setError("Your BenchQ session ended. Sign in again.");
    void sendToBackground({ type: "clear-connections" });
  }, []);
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
    setLoading(true);
    setError("");
    setJobs([]);
    try {
      const current = await getSession();
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
      setLoading(false);
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
    if (!reply?.ok) setError("Could not open this job. Try again.");
  };
  const apply = async (job: Application, form: AppliedForm, resumeId: string | null) => {
    setBusy(job.id);
    setError("");
    try {
      const updated = await markApplied(job, form, resumeId);
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
      // The job is done: the tab stays open on the page, but nothing is left to fill.
      forgetForm(job.id);
      void sendToBackground({ type: "disconnect-job", applicationId: job.id });
    } catch (e) {
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
    if (!reply?.ok) setError("Could not use this tab. Try Open job.");
  };
  const openJobLink = (job: Application) => {
    if (isConnectable(job)) {
      return (
        <button
          type="button"
          className={button("secondary", "small")}
          onClick={() => void openJob(job)}
        >
          {OPEN_JOB}
        </button>
      );
    }
    if (job.url) {
      return (
        <a
          className={button("secondary", "small")}
          href={job.url}
          target="_blank"
          rel="noreferrer"
        >
          {OPEN_JOB}
        </a>
      );
    }
    return (
      <button type="button" className={button("secondary", "small")} disabled>
        {OPEN_JOB}
      </button>
    );
  };
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null;
  // A job on the page the BDE is looking at, not yet one of the candidate's: added and Saved, then the tab connects.
  const addJobCard = !connection && selectedCandidate && !loadingJobs ? (
    <AddJobCard key={`${selectedCandidate.id}:${activeBrowserTab?.id ?? ""}:${activeBrowserTab?.url ?? ""}`} tab={activeBrowserTab} candidateId={selectedCandidate.id}
      candidateName={selectedCandidate.full_name} knownUrls={jobs.flatMap((job) => (job.url ? [job.url] : []))} knownJobs={jobs}
      onUseTab={(known) => { const job = jobs.find(({ id }) => id === known.id); if (job?.status === "saved") void connectThisTab(job); }}
      onAdded={(application) => {
        loadJobs(selectedCandidate.id).catch(() => undefined);
        void openJob(application);
      }} />
  ) : null;
  const jobsArea = (
    <>
      {addJobCard}
      <JobTabs
        active={activeTab}
        counts={
          loadingJobs
            ? null
            : { saved: savedJobs.length, applied: appliedJobs.length }
        }
        onChange={setActiveTab}
      />
      <div id={JOB_PANEL} role="tabpanel" aria-labelledby={tabId(activeTab)}>
        {loadingJobs ? (
          <p className={`my-3 ${MUTED_TEXT}`}>Loading jobs…</p>
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
          <section className="grid gap-2" aria-label={`${activeTab} jobs`}>
            {visibleJobs.map((job) => (
              <article
                data-slot="job"
                className={`p-3 transition-[border-color,box-shadow] ${MOTION} hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-sm)] ${CARD}`}
                key={job.id}
              >
                <div className={EYEBROW}>{job.company || "Company"}</div>
                <h2 className="my-0.5 text-h3">
                  {isConnectable(job) ? (
                    <button
                      type="button"
                      data-slot="job-select"
                      className="text-left hover:text-[var(--color-primary)]"
                      onClick={() => void openJob(job)}
                    >
                      {job.title || "Untitled role"}
                    </button>
                  ) : (
                    job.title || "Untitled role"
                  )}
                </h2>
                <p className={`mb-2.5 ${MUTED_TEXT}`}>
                  {job.location || "Location not listed"}
                </p>
                <div className="flex gap-1.5 *:min-w-0 *:flex-1">
                  {openJobLink(job)}
                  {job.status === "applied" && (
                    <button className={button("primary", "small")} disabled>
                      Applied
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </>
  );
  return (
    <main className={WORKSPACE}>
      <header className={TOPBAR}>
        <div className="flex min-w-0 items-center gap-2 text-h3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="block size-[var(--control-sm)] rounded-[var(--radius-md)] object-cover"
            src="/icons/icon128.png"
            alt=""
          />
          <span>BenchQ</span>
        </div>
        <div className="flex min-w-0 flex-none items-center gap-1.5">
          <button
            className={ICON_BUTTON_RAISED}
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
            className={button("secondary", "small")}
            onClick={() => void refresh()}
            aria-label="Refresh saved jobs"
            title="Refresh saved jobs"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </header>
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
          <div
            className={`flex min-w-0 items-center gap-1.5 pt-3 pb-2 ${MUTED_TEXT}`}
          >
            <svg
              className="size-[var(--icon-sm)] flex-none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="5" />
              <path d="M20 21a8 8 0 0 0-16 0" />
            </svg>
            <h1 className="flex-[0_1_auto] truncate text-sm font-[550] text-[var(--color-text)]">
              {session.user?.name || "BDE"}
            </h1>
            <span className="min-w-0 flex-[1_1_0] truncate">
              · BDE · {session.firm?.name || session.firm?.slug || "BenchQ"}
            </span>
          </div>
          {error && (
            <p data-slot="error" className={`mb-2.5 ${ALERT}`}>
              {error}
            </p>
          )}
          {!hasAutofillPermissions() && (
            <p data-slot="error" className={`mb-2.5 ${ALERT}`}>
              Autofill is off because Chrome hasn&apos;t reloaded this
              extension. Open chrome://extensions and click Reload on BenchQ
              Apply.
            </p>
          )}
          <div className="mb-3 grid gap-1">
            <label
              className="text-label text-[var(--color-text-2)]"
              htmlFor="candidate-select"
            >
              Show jobs for
            </label>
            <div className="group relative" {...lockDetails}>
              <select
                id="candidate-select"
                className={CANDIDATE_SELECT}
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
          </div>
          {connection ? (
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
    </main>
  );
}

reloadIfManifestIsStale();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
