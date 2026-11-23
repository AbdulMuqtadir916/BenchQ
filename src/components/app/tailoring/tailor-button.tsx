"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { Candidate } from "@/lib/schemas/candidate";
import type { ResumeShelf } from "@/lib/schemas/resume";
import { buildResumeTree } from "@/lib/derive/resume-tree";
import { canManageResume } from "@/lib/auth/permissions";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { useResumeShelf } from "@/lib/hooks/use-resumes";
import { useMyTailorings, useStartTailoring } from "@/lib/hooks/use-tailoring";
import { useHref } from "@/lib/routes/use-href";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { describeError, screenErrorText, type ErrorText } from "@/lib/api/error-text";
import { ErrorReference } from "@/components/app/error-reference";
import { startRefusal } from "./messages";

interface TailorButtonProps {
  candidate: Candidate;
  /** One of the candidate's own jobs (its id is their posting's). */
  job: { id: string; title: string };
  /** "icon": a row's sparkle (the dashboard queue), the same picker beside it. */
  variant?: "button" | "icon";
  /**
   * Which side the controls and the note line up on. Default: "end" for the button variant (a header's actions),
   * "start" for the icon variant.
   */
  align?: "start" | "end";
  /** The caller's actions before the Tailor control, in its group (so they line up with it and wrap with it). */
  leading?: ReactNode;
  /**
   * The caller's actions after the Tailor control, in its group. They come before the note in the DOM, so focus order
   * matches what the eye sees: the actions, then the note's links and Copy (WCAG 2.4.3).
   */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Tailor the candidate's résumé for this job (docs/02 §8.3; decided 2026-11-12, part 3): the click uses the source in
 * the picker, by default the active base's v1; the picker lists the visible bases' own versions (R3-Q1, R3-Q3). Only
 * the candidate's BDE sees it (07 Q55). Once a copy exists for that base and job it reads "Tailor again", with "Open
 * tailored" beside it (Q5); while that source and job run it is dimmed.
 */
export function TailorButton(props: TailorButtonProps) {
  const principal = useSignedInPrincipal();
  if (!canManageResume(principal, props.candidate)) {
    // No Tailor for this user: the caller's own actions still render, in the same group.
    if (!props.leading && !props.trailing) return null;
    const isIcon = props.variant === "icon";
    return <div className={cn(groupClass(isIcon, isStartAligned(props)), props.className)}>{props.leading}{props.trailing}</div>;
  }
  return <TailorControl {...props} />;
}

function isStartAligned({ align, variant }: Pick<TailorButtonProps, "align" | "variant">): boolean {
  return (align ?? (variant === "icon" ? "start" : "end")) === "start";
}

/** The actions' group: wraps onto a second line rather than overflow a narrow card. */
function groupClass(isIcon: boolean, isStart: boolean): string {
  return cn("flex flex-wrap items-center", isIcon ? "shrink-0 gap-1" : "min-w-0 max-w-full gap-2", isStart ? "justify-start" : "justify-end");
}

interface Source extends SelectOption {
  /** The base a tailoring from it goes under, when that base exists already. */
  baseId: string | null;
}

/** The picker's choices: each visible base's versions, oldest first; a version whose base was hidden can't be used. */
export function tailorSources(shelf: ResumeShelf, candidateId: string): { sources: Source[]; defaultId: string | null } {
  const tree = buildResumeTree(shelf, [candidateId]).find((c) => c.candidateId === candidateId);
  const sources: Source[] = [];
  let defaultId: string | null = null;
  for (const node of tree?.bases ?? []) {
    for (const version of [...node.versions].sort((a, b) => a.number - b.number)) {
      const made = version.number === 1 ? node.base : shelf.bases.find((b) => b.promotedFromResumeId === version.id) ?? null;
      const madeNumber = made ? tree?.bases.concat(tree.hidden).find((b) => b.base.id === made.id)?.number : null;
      const isActiveV1 = node.base.isActive && version.number === 1;
      if (isActiveV1) defaultId = version.id;
      sources.push({
        value: version.id,
        label: `Base ${node.number} v${version.number}${isActiveV1 ? " · active" : ""}`,
        description: made?.archivedAt
          ? `Base ${madeNumber ?? ""} (made from it) is hidden`
          : version.number === 1 ? undefined : made ? `Goes under Base ${madeNumber ?? ""}` : "Becomes a base of its own",
        disabled: Boolean(made?.archivedAt),
        baseId: made?.id ?? null,
      });
    }
  }
  return { sources, defaultId };
}

function TailorControl({ candidate, job, variant = "button", align, leading, trailing, className }: TailorButtonProps) {
  const toHref = useHref();
  const shelfQuery = useResumeShelf(candidate.id);
  const runsQuery = useMyTailorings();
  const start = useStartTailoring();
  const { sources, defaultId } = useMemo(
    () => (shelfQuery.data ? tailorSources(shelfQuery.data, candidate.id) : { sources: [], defaultId: null }),
    [shelfQuery.data, candidate.id],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const sourceId = picked && sources.some((s) => s.value === picked && !s.disabled) ? picked : defaultId;
  const source = sources.find((s) => s.value === sourceId) ?? null;

  // A copy already tailored from this source's base for this job: "Tailor again" makes its next version.
  const copy = useMemo(() => {
    if (!shelfQuery.data || !source?.baseId) return null;
    return shelfQuery.data.resumes.find((r) => !r.isMaster && r.baseResumeId === source.baseId && r.targetJobId === job.id) ?? null;
  }, [shelfQuery.data, source, job.id]);
  const isRunning = (runsQuery.data ?? []).some((r) => r.status === "running" && r.sourceResumeId === sourceId && r.jobId === job.id);
  const refusal = start.error ? startRefusal(start.error) : null;
  const isReady = Boolean(sourceId) && !isRunning && !start.isPending;
  const label = isRunning || start.isPending ? "Tailoring…" : copy ? "Tailor again" : "Tailor";

  function tailor() {
    if (!isReady || !sourceId) return;
    start.mutate({ candidateId: candidate.id, jobId: job.id, resumeId: sourceId });
  }

  const Icon = isRunning || start.isPending ? LoaderCircle : Sparkles;
  const hasNoBase = Boolean(shelfQuery.data && !defaultId);
  // The shelf's failure first (a system error reads as everywhere else; any other keeps this screen's words), then a
  // missing base, then the start's refusal.
  const shelfFailure = shelfQuery.error ? describeError(shelfQuery.error, { screenText: () => "Résumés didn't load." }) : null;
  const notice: ErrorText | null = shelfFailure ?? (hasNoBase ? screenErrorText("No active base résumé.") : refusal);
  const problem = notice?.message ?? null;

  const isIcon = variant === "icon";
  const isStart = isStartAligned({ align, variant });
  const noteId = `tailor-${candidate.id}-${job.id}`;
  return (
    // DOM order is the visual order: the group (leading, Tailor, picker, Open tailored, trailing), then the note.
    // The icon variant's wrapper is `contents`: the group and the note become items of the row it sits in, so the note
    // takes a line of its own below the row instead of squeezing the row's title (the row must wrap: see the dashboard
    // queue). The button variant is a column: the group, the note under it.
    <div className={cn(isIcon ? "contents" : cn("flex min-w-0 max-w-full flex-col gap-1", isStart ? "items-start" : "items-end"), className)}>
      <div className={groupClass(isIcon, isStart)}>
        {leading}
        {isIcon ? (
          <Button variant="ghost" size="icon" aria-label={`Tailor resume for ${job.title}`} title={label} onClick={tailor} disabled={!isReady}
            aria-describedby={problem ? noteId : undefined}>
            <Icon size={15} aria-hidden className={cn((isRunning || start.isPending) && "animate-spin")} />
          </Button>
        ) : (
          <Button size="sm" onClick={tailor} disabled={!isReady} aria-describedby={problem ? noteId : undefined}>
            <Icon size={13} aria-hidden className={cn((isRunning || start.isPending) && "animate-spin")} />{label}
          </Button>
        )}
        {sources.length > 1 ? (
          <Select value={sourceId ?? ""} options={sources} onValueChange={(value) => { setPicked(value); start.reset(); }}
            aria-label="Tailor from" className={isIcon ? "w-28" : "w-40"} />
        ) : null}
        {copy && !isIcon ? (
          <Button asChild variant="ghost" size="sm"><Link href={toHref("resumes.studio", { id: copy.latestVersionId })}>Open tailored</Link></Button>
        ) : null}
        {trailing}
      </div>
      {problem ? (
        // `@container` (inline-size containment): the note adds nothing to its parent's intrinsic width, so a long
        // message or request id never widens the actions; it takes the width they have and wraps in it.
        <p id={noteId} role="alert" className={cn(
          "@container min-w-0 text-caption text-[var(--color-danger-fg)]",
          // Icon: the row's last line, full width. Button: the group's width, under it.
          isIcon ? "basis-full" : "self-stretch",
          isStart ? "text-left" : "text-right",
        )}>
          {problem}
          {notice?.reference ? <> <ErrorReference reference={notice.reference} /></> : null}
          {!shelfFailure && (hasNoBase || refusal?.needsBase) ? <> <Link className="underline" href={toHref("candidates.detail", { id: candidate.id }, { tab: "resumes" })}>Résumés</Link></> : null}
          {shelfFailure?.canRetry ? <> <button type="button" className="underline" onClick={() => void shelfQuery.refetch()}>Retry</button></> : null}
        </p>
      ) : null}
    </div>
  );
}
