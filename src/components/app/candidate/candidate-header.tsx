"use client";

import Link from "next/link";
import { ArrowLeft, BadgeCheck, CalendarCheck, Clock3, FileText, MapPin, Percent, Send, Sparkles, Zap, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { Candidate, CandidateStats } from "@/lib/schemas/candidate";
import type { CandidateStatus } from "@/lib/schemas/enums";
import { EASE_OUT } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Tag, type TagTone } from "@/components/ui/tag";
import { WorkAuthChip } from "@/components/app/work-auth-chip";
import { AvatarStack } from "@/components/app/avatar-stack";
import { CandidateAvatar } from "@/components/app/candidate-avatar";
import { Can } from "@/lib/auth/can";
import type { CandidateTabId } from "./candidate-tabs";
import { ReassignAction } from "./reassign-dialog";
import { useHref } from "@/lib/routes/use-href";

const STATUS: Record<CandidateStatus, { label: string; tone: TagTone }> = {
  ON_BENCH: { label: "On bench", tone: "blue" },
  INTERVIEWING: { label: "Interviewing", tone: "violet" },
  OFFER: { label: "Offer", tone: "green" },
  PLACED: { label: "Placed", tone: "teal" },
  PAUSED: { label: "Paused", tone: "amber" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
};

interface CandidateHeaderProps {
  candidate: Candidate;
  stats: CandidateStats | null;
  ownerName: string | null;
  /** Ownership is a team-level concern — shown to managers and owners, not to the BDE on their own queue. */
  showOwner: boolean;
  canAct: boolean;
  resumeHref: string;
  onFindJobs: () => void;
  onOpenTab: (tab: CandidateTabId) => void;
}

/** Who this is, where they stand, and the two actions a BDE takes most. Every number opens the rows behind it. */
export function CandidateHeader({ candidate, stats, ownerName, showOwner, canAct, resumeHref, onFindJobs, onOpenTab }: CandidateHeaderProps) {
  const toHref = useHref();
  const reduce = useReducedMotion() ?? false;
  const place = [candidate.city, candidate.state].filter(Boolean).join(", ");
  const isAvailable = !candidate.availableFrom || new Date(candidate.availableFrom) <= new Date();
  const status = STATUS[candidate.status];

  const statItems: Array<{ label: string; value: string | number; Icon: LucideIcon; tab: CandidateTabId }> = stats
    ? [
        { label: "Applications", value: stats.applicationsSubmitted, Icon: Send, tab: "applications" },
        { label: "Active", value: stats.applicationsOpen, Icon: Zap, tab: "applications" },
        { label: "Interviews", value: stats.interviewsScheduled, Icon: CalendarCheck, tab: "applications" },
        { label: "Offers", value: stats.offersReceived, Icon: BadgeCheck, tab: "applications" },
        { label: "Response rate", value: `${stats.responseRatePct}%`, Icon: Percent, tab: "inbox" },
        { label: "Days on bench", value: stats.daysOnBench, Icon: Clock3, tab: "activity" },
      ]
    : [];

  return (
    <header className="mb-5">
      <Link href={toHref("candidates")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-3)] hover:text-[var(--color-text)]">
        <ArrowLeft size={14} aria-hidden /> Candidates
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <motion.span initial={reduce ? false : { scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="inline-flex">
            <CandidateAvatar name={candidate.fullName} colorKey={candidate.id} size="lg" />
          </motion.span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-h1 text-[var(--color-text)]">{candidate.fullName}</h1>
              <WorkAuthChip workAuth={candidate.workAuth} expiry={candidate.workAuthExpiry} />
              <Tag tone={status.tone}>{status.label}</Tag>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body text-[var(--color-text-2)]">
              <span className="text-body-strong">{candidate.primaryRole ?? "Open role"}</span>
              {place ? <span className="inline-flex items-center gap-1 text-[var(--color-text-3)]"><MapPin size={13} aria-hidden />{place}</span> : null}
              {candidate.yearsExperience ? <span className="text-[var(--color-text-3)]">· {candidate.yearsExperience} yrs</span> : null}
              {candidate.rateTarget ? <span className="tabular text-[var(--color-text-3)]">· ${candidate.rateTarget}/hr target</span> : null}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-text-3)]">
              {showOwner && ownerName ? <span className="inline-flex items-center gap-1.5"><AvatarStack people={[{ name: ownerName }]} />Owned by {ownerName}</span> : null}
              <span className={isAvailable ? "text-[var(--color-success-fg)]" : undefined}>{isAvailable ? "Available now" : `Available ${new Date(candidate.availableFrom!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}</span>
              {candidate.willingToRelocate ? <span>Open to relocate</span> : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Can action="candidate.assign"><ReassignAction candidate={candidate} /></Can>
          {canAct ? (
            <>
              <Button variant="secondary" onClick={onFindJobs}><Sparkles size={14} aria-hidden />Find jobs</Button>
              <Button asChild><Link href={resumeHref}><FileText size={14} aria-hidden />Build resume</Link></Button>
            </>
          ) : null}
        </div>
      </div>

      {statItems.length ? (
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-3 lg:grid-cols-6">
          {statItems.map(({ label, value, Icon, tab }) => (
            <button
              key={label}
              type="button"
              onClick={() => onOpenTab(tab)}
              className="group bg-[var(--color-surface)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-2)] focus-visible:relative focus-visible:z-10"
            >
              <span className="flex items-center gap-1.5 text-label text-[var(--color-text-3)] group-hover:text-[var(--color-text-2)]">
                <Icon size={13} aria-hidden />
                {label}
              </span>
              <span className="tabular mt-0.5 block text-h2 text-[var(--color-text)]">{value}</span>
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}
