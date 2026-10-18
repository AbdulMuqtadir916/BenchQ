"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Send, Mail, SkipForward, X, Clock, Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useJobs } from "@/lib/hooks/use-jobs";
import { useApplications } from "@/lib/hooks/use-applications";
import { useSignedInUser } from "@/lib/stores/session-store";
import { rankJobsForCandidate } from "@/lib/derive";
import { MatchScore } from "@/components/app/match-score";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import { useHref } from "@/lib/routes/use-href";

export default function FocusModePage() {
  const toHref = useHref();
  const user = useSignedInUser();
  const candidatesQuery = useCandidates();
  const jobsQuery = useJobs({ limit: 400 });
  const applicationsQuery = useApplications();

  const myCandidates = useMemo(() => {
    const cs = candidatesQuery.data ?? [];
    const mine = user.role === "BDE" ? cs.filter((c) => c.assignedUserIds.includes(user.id)) : cs;
    return mine.filter((c) => c.status === "ON_BENCH" || c.status === "INTERVIEWING");
  }, [candidatesQuery.data, user]);

  const [candidateId, setCandidateId] = useState<string>("");
  const candidate = myCandidates.find((c) => c.id === candidateId) ?? myCandidates[0] ?? null;

  const queue = useMemo(() => {
    if (!candidate) return [];
    const applied = new Set((applicationsQuery.data ?? []).filter((a) => a.candidateId === candidate.id).map((a) => a.jobId));
    return rankJobsForCandidate(candidate, jobsQuery.data ?? [], applied, 24);
  }, [candidate, jobsQuery.data, applicationsQuery.data]);

  const [index, setIndex] = useState(0);
  const [applied, setApplied] = useState(0);
  const [tailored, setTailored] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const current = queue[index] ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (finished || !current) return;
      const k = e.key.toLowerCase();
      if (k === "t") { setTailored((n) => n + 1); next(); }
      else if (k === "a") { setApplied((n) => n + 1); next(); }
      else if (k === "o") { next(); }
      else if (k === "s") { next(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, finished, index]);

  function next() {
    setReviewed((n) => n + 1);
    if (index + 1 >= queue.length) setFinished(true);
    else setIndex((i) => i + 1);
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-bg)] p-4 text-[var(--color-text)]">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between">
        <div className="flex items-center gap-3 text-sm text-[var(--color-text-2)]">
          {candidate ? (
            <select value={candidate.id} onChange={(e) => { setCandidateId(e.target.value); setIndex(0); setFinished(false); setApplied(0); setTailored(0); setReviewed(0); startRef.current = Date.now(); }} className="bq-input h-8 w-auto">
              {myCandidates.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>
          ) : <span>No candidate</span>}
          {!finished && queue.length > 0 ? <span className="tabular">job {Math.min(index + 1, queue.length)} of {queue.length}</span> : null}
          <span className="tabular inline-flex items-center gap-1 text-[var(--color-text-3)]"><Clock size={13} aria-hidden />{mm}:{ss}</span>
        </div>
        <Button asChild variant="ghost" size="sm"><Link href={toHref("dashboard")}><X size={14} aria-hidden />Esc exit</Link></Button>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center">
        {!candidate ? (
          <p className="text-[var(--color-text-3)]">Assign a candidate to run the queue.</p>
        ) : finished || !current ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-[var(--shadow-lg)]">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-success-bg)] text-[var(--color-success-fg)]"><Check size={22} aria-hidden /></div>
            <h1 className="text-h1">Run complete</h1>
            <p className="mt-1 text-body text-[var(--color-text-3)]">{candidate.fullName} · {mm}:{ss} elapsed</p>
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              {[["Reviewed", reviewed], ["Tailored", tailored], ["Applied", applied]].map(([l, v]) => (
                <div key={l} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
                  <div className="text-display tabular">{v}</div>
                  <div className="text-caption text-[var(--color-text-3)]">{l}</div>
                </div>
              ))}
            </div>
            <Button asChild className="mt-6 w-full"><Link href={toHref("dashboard")}>Back to dashboard</Link></Button>
          </motion.div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={current.job.id}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.18 }}
              className="w-full rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-lg)]"
            >
              <div className="mb-1 flex items-center gap-2 text-caption text-[var(--color-text-3)]">
                <span>{current.job.company.name}</span>
                <span>·</span>
                <span>{current.job.remoteMode === "REMOTE" ? "Remote" : `${current.job.city}, ${current.job.state}`}</span>
                {current.job.rateMax ? <><span>·</span><span className="tabular">${current.job.rateMin}–{current.job.rateMax}/hr</span></> : null}
              </div>
              <h1 className="text-h1">{current.job.title}</h1>
              <div className="mt-3"><MatchScore score={current.score} /></div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {current.job.requirements.slice(0, 8).map((r) => (
                  <Tag key={r.id} tone={r.kind === "MANDATORY" ? "blue" : "neutral"}>{r.value}</Tag>
                ))}
              </div>

              <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <FocusAction k="T" label="Tailor" Icon={Sparkles} onClick={() => { setTailored((n) => n + 1); next(); }} primary />
                <FocusAction k="A" label="Applied" Icon={Send} onClick={() => { setApplied((n) => n + 1); next(); }} />
                <FocusAction k="O" label="Outreach" Icon={Mail} onClick={next} />
                <FocusAction k="S" label="Skip" Icon={SkipForward} onClick={next} />
              </div>
              <p className="mt-4 text-center text-caption text-[var(--color-text-3)]">One keystroke per job — T tailor · A applied · O outreach · S skip</p>
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}

function FocusAction({ k, label, Icon, onClick, primary }: { k: string; label: string; Icon: typeof Send; onClick: () => void; primary?: boolean }) {
  return (
    <Button variant={primary ? "primary" : "secondary"} onClick={onClick} className="h-auto flex-col gap-1 py-3">
      <Icon size={18} aria-hidden />
      <span>{label}</span>
      <kbd className="text-mono-sm opacity-70">{k}</kbd>
    </Button>
  );
}
