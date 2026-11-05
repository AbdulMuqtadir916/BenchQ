import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Application, BENCHQ_URL, Candidate, getCandidates, getSavedApplications, getSession, markApplied, Session } from "./api";
import JobHighlight from "./JobHighlight";
import "./style.css";

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState(() => localStorage.getItem("benchq-selected-candidate") || "");
  const [jobs, setJobs] = useState<Application[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [watchingLogin, setWatchingLogin] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("benchq-theme") === "dark" ? "dark" : "light");
  const [activeTab, setActiveTab] = useState<"saved" | "applied">("saved");
  const [selectedJob, setSelectedJob] = useState<Application | null>(null);
  const savedJobs = jobs.filter((job) => job.status === "saved");
  const appliedJobs = jobs.filter((job) => job.status === "applied");
  const visibleJobs = activeTab === "saved" ? savedJobs : appliedJobs;
  const expireSession = useCallback(() => {
    setSession(null); setCandidates([]); setSelectedCandidateId(""); setJobs([]);
    setSelectedJob(null);
    localStorage.removeItem("benchq-selected-candidate");
    setError("Your BenchQ session ended. Sign in again.");
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true); setError(""); setJobs([]);
    try {
      const current = await getSession(); setSession(current);
      if (current.principal.kind !== "firm" || current.principal.role !== "BDE" || !current.principal.firm_id) {
        setCandidates([]); setSelectedCandidateId(""); setJobs([]); return;
      }
      const assignedCandidates = (await getCandidates(current.principal.firm_id))
        .sort((left, right) => left.full_name.localeCompare(right.full_name));
      setCandidates(assignedCandidates);
      const storedCandidateId = localStorage.getItem("benchq-selected-candidate") || "";
      const candidateId = assignedCandidates.some((candidate) => candidate.id === storedCandidateId)
        ? storedCandidateId
        : assignedCandidates[0]?.id || "";
      setSelectedCandidateId(candidateId);
      if (candidateId) {
        localStorage.setItem("benchq-selected-candidate", candidateId);
        setJobs(await getSavedApplications(candidateId));
      } else {
        localStorage.removeItem("benchq-selected-candidate");
        setJobs([]);
      }
    } catch (e) {
      setSession(null); setCandidates([]); setSelectedCandidateId(""); setJobs([]);
      setError(e instanceof Error && e.message === "SESSION_EXPIRED" ? "Your BenchQ session expired. Sign in and retry." : "Could not reach BenchQ. Check the app connection and retry.");
    } finally { setLoading(false); }
  }, []);
  // Preserve the existing mount-time session and job refresh behavior.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    let checking = false;
    const checkSession = async () => {
      if (!active || checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const current = await getSession();
        if (current.principal.user_id !== session.principal.user_id
          || current.principal.kind !== session.principal.kind
          || current.principal.role !== session.principal.role
          || current.principal.firm_id !== session.principal.firm_id) {
          await refresh();
        }
      } catch (e) {
        if (active && e instanceof Error && e.message === "SESSION_EXPIRED") expireSession();
      } finally { checking = false; }
    };
    const timer = window.setInterval(() => { void checkSession(); }, 15000);
    window.addEventListener("focus", checkSession);
    document.addEventListener("visibilitychange", checkSession);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", checkSession);
      document.removeEventListener("visibilitychange", checkSession);
    };
  }, [session, refresh, expireSession]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("benchq-theme", theme); }, [theme]);
  useEffect(() => {
    if (!watchingLogin || session) return;
    const timer = window.setInterval(() => {
      void getSession().then(() => { setWatchingLogin(false); void refresh(); }).catch(() => undefined);
    }, 2500);
    const stop = window.setTimeout(() => setWatchingLogin(false), 120000);
    return () => { window.clearInterval(timer); window.clearTimeout(stop); };
  }, [watchingLogin, session, refresh]);
  const login = () => { setWatchingLogin(true); void chrome.tabs.create({ url: `${BENCHQ_URL}/sign-in` }); };
  const chooseCandidate = async (candidateId: string) => {
    setSelectedCandidateId(candidateId);
    setSelectedJob(null);
    localStorage.setItem("benchq-selected-candidate", candidateId);
    setActiveTab("saved"); setLoadingJobs(true); setError(""); setJobs([]);
    try { setJobs(await getSavedApplications(candidateId)); }
    catch (e) {
      setJobs([]);
      if (e instanceof Error && e.message === "SESSION_EXPIRED") expireSession();
      else setError("Could not load this candidate’s jobs. Refresh and try again.");
    } finally { setLoadingJobs(false); }
  };
  const apply = async (job: Application) => {
    setBusy(job.id); setError("");
    try {
      const updated = await markApplied(job);
      setJobs((all) => all.map((item) => item.id === job.id ? {
        ...item,
        status: updated.status,
        status_revision: updated.status_revision,
        status_transitions: updated.status_transitions,
      } : item));
      setSelectedJob((current) => current?.id === job.id ? null : current);
      setActiveTab("applied");
    }
    catch (e) {
      if (e instanceof Error && e.message === "SESSION_EXPIRED") expireSession();
      else setError("Could not update this application. Refresh and try again.");
    }
    finally { setBusy(null); }
  };
  return <main>
    <header>
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand-mark" src="/logo-mark.png" alt="BenchQ" />
      </div>
      <div className="header-actions">
        <button className="icon-button" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
          {theme === "light" ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6.9 6.9 0 0 0 8.268 8.268c.344-.215.825-.003.803.401" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>}
        </button>
        <button className="secondary-button refresh-button" onClick={() => void refresh()} aria-label="Refresh saved jobs" title="Refresh saved jobs">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          <span>Refresh</span>
        </button>
      </div>
    </header>
    {loading ? <p className="muted">Checking your BenchQ session…</p> : !session ? <section className="notice"><h1>Sign in to BenchQ</h1><p>{error || "Connect your BenchQ account to view your saved jobs."}</p><button className="primary" onClick={login}>Login</button><button className="text-button" onClick={() => void refresh()}>I’m signed in · Retry</button></section>
    : session.principal.kind !== "firm" || session.principal.role !== "BDE" ? <section className="notice"><h1>BDE account required</h1><p>This extension is designed for BDE users to quickly access their favourite jobs and track applications. Please log in with a BDE account to use it.</p></section>
    : <>
      <div className="welcome"><div className="identity"><span className="avatar">{session.user?.name?.split(/\s+/).map((part) => part[0]).slice(0,2).join("").toUpperCase() || "BQ"}</span><div><h1>{session.user?.name || "BDE"}</h1><span className="role-firm">BDE <span>·</span> {session.firm?.name || session.firm?.slug || "BenchQ"}</span></div></div></div>
      {error && <p className="error">{error}</p>}
      <div className="candidate-picker"><label htmlFor="candidate-select">Candidate</label><select id="candidate-select" value={selectedCandidateId} disabled={loading || candidates.length === 0} onChange={(event) => void chooseCandidate(event.target.value)}>{candidates.length === 0 ? <option value="">No assigned candidates</option> : candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.full_name}</option>)}</select></div>
      {selectedJob && selectedCandidateId && <JobHighlight
        key={`${selectedCandidateId}:${selectedJob.id}`}
        job={jobs.find((job) => job.id === selectedJob.id) ?? selectedJob}
        busy={busy === selectedJob.id}
        onApply={() => void apply(jobs.find((job) => job.id === selectedJob.id) ?? selectedJob)}
        onClose={() => setSelectedJob(null)}
      />}
      <div className="tabs" role="group" aria-label="Job status filter">
        <button type="button" className="tab" aria-pressed={activeTab === "saved"} onClick={() => setActiveTab("saved")}>Saved <span>{savedJobs.length}</span></button>
        <button type="button" className="tab" aria-pressed={activeTab === "applied"} onClick={() => setActiveTab("applied")}>Applied <span>{appliedJobs.length}</span></button>
      </div>
      {loadingJobs
        ? <p className="muted">Loading jobs…</p>
        : visibleJobs.length === 0
        ? <section className="empty"><h2>No {activeTab} jobs</h2><p>{activeTab === "saved" ? "Saved jobs for candidates assigned to you will appear here." : "Jobs you apply to will appear here."}</p></section>
        : <section className="jobs" aria-label={`${activeTab} jobs`}>
          {visibleJobs.map((job) => <article className="job" key={job.id}>
            <div className="eyebrow">{job.company || "Company"}</div>
            <h2>{job.title || "Untitled role"}</h2>
            <p className="muted">{job.location || "Location not listed"}</p>
            <div className="actions">
              {job.url
                ? <a className="secondary-button open-job" href={job.url} target="_blank" rel="noreferrer" onClick={() => setSelectedJob(job)}>
                    <span>Open job</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m-1-5-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg>
                  </a>
                : <button type="button" className="secondary-button open-job" disabled><span>Open job</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m-1-5-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg></button>}
              {job.status === "applied"
                ? <button className="primary small" disabled>Applied</button>
                : <button className="primary small" disabled={busy === job.id} onClick={() => void apply(job)}>{busy === job.id ? "Saving…" : "Apply"}</button>}
            </div>
          </article>)}
        </section>}
    </>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
