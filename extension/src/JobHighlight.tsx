import React, { useEffect, useRef, useState } from "react";
import type { Application } from "./api";

type JobHighlightProps = {
  job: Application;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
};

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function getJobDetails(job: Application): {
  workType: string | null;
  salary: string | null;
  dateLabel: string | null;
  score: string | null;
  description: string | null;
} {
  const arrangements = [
    job.arr_remote ? "Remote" : "",
    job.arr_hybrid ? "Hybrid" : "",
    job.arr_onsite ? "On-site" : "",
  ].filter(Boolean);
  const workType = job.work_type || job.employment_type || job.job_type || arrangements.join(" · ") || (job.remote === true ? "Remote" : null);
  const money = (value: number) => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
  const salary = job.salary_min != null && job.salary_max != null
    ? `${money(job.salary_min)} – ${money(job.salary_max)}`
    : job.salary_min != null ? `From ${money(job.salary_min)}`
      : job.salary_max != null ? `Up to ${money(job.salary_max)}`
        : null;
  const date = job.posted_at || job.discovered_at || null;
  const formattedDate = formatDate(date);
  const dateLabel = formattedDate ? `${job.posted_at ? "Posted" : "Found"} ${formattedDate}` : null;
  const score = job.match_score ?? job.best_cv_score ?? job.best_score;
  const description = job.description?.replace(/\s+/g, " ").trim().slice(0, 320) || null;

  return {
    workType,
    salary,
    dateLabel,
    score: typeof score === "number" ? `${Math.round(score)}${score <= 100 ? "%" : ""} match` : null,
    description,
  };
}

export default function JobHighlight({ job, busy, onApply, onClose }: JobHighlightProps) {
  const closeTimer = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const details = getJobDetails(job);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCard();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  function closeCard() {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 180);
  }

  const descriptionTooLong = Boolean(job.description && job.description.length > 320);

  return <section className={`highlight-card${closing ? " is-closing" : ""}`} aria-labelledby="highlight-title">
    <div className="highlight-heading">
      <div className="highlight-heading-copy">
        <span className="eyebrow">Selected job</span>
        <h2 id="highlight-title">{job.title || "Untitled role"}</h2>
        <p className="highlight-company">{job.company || "Company not listed"}</p>
      </div>
      <button type="button" className="icon-button close-button" onClick={closeCard} aria-label="Close selected job details" title="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>

    <div className="job-facts" aria-label="Job details">
      {job.location && <span>{job.location}</span>}
      {details.workType && <span>{details.workType}</span>}
      {details.salary && <span>{details.salary}</span>}
      {details.dateLabel && <span>{details.dateLabel}</span>}
      {details.score && <span>{details.score}</span>}
    </div>
    {details.description && <p className="job-description">{details.description}{descriptionTooLong ? "…" : ""}</p>}

    <div className="highlight-actions">
      <button type="button" className="primary-button highlight-apply" onClick={onApply} disabled={busy || job.status === "applied"}>
        {job.status === "applied" ? "Applied" : busy ? "Saving…" : "Apply"}
      </button>
    </div>
  </section>;
}
