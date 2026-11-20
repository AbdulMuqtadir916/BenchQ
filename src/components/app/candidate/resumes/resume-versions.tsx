"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { TreeTailored, TreeVersion } from "@/lib/derive/resume-tree";
import { formatRelative } from "@/lib/format/timezone";
import { useHref } from "@/lib/routes/use-href";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import type { TreeLabels } from "@/components/app/resumes/base-folder";
import { DownloadPdfButton } from "./download-pdf";
import { copyTitle, updatedLine, versionLine } from "./resume-cards";

/** A text link that opens or closes a part of the card ("See older versions (1)"). */
export function Reveal({ label, isOpen, onToggle, controls }: { label: string; isOpen: boolean; onToggle: () => void; controls: string }) {
  return (
    <button type="button" aria-expanded={isOpen} aria-controls={controls} onClick={onToggle}
      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] text-sm text-[var(--color-primary-subtle-fg)] hover:underline">
      <ChevronRight size={13} aria-hidden className={cn("transition-transform duration-[var(--duration-base)]", isOpen && "rotate-90")} />
      {label}
    </button>
  );
}

/** One line per version: who saved it and when, then View and what else this person may do with it. */
export function VersionList({ id, versions, title, labels, source, onSaveAsNew, onDelete }: {
  id: string;
  versions: readonly TreeVersion[];
  title: string;
  labels: TreeLabels;
  source: "UPLOAD" | "PROMOTED";
  onSaveAsNew?: (version: TreeVersion) => void;
  onDelete?: (version: TreeVersion) => void;
}) {
  const toHref = useHref();
  return (
    <ul id={id} className="mt-2 divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)]">
      {versions.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span className="min-w-0 flex-1 text-sm text-[var(--color-text-2)]">{versionLine(v, labels.userName(v.createdByUserId), formatRelative(v.createdAt), source)}</span>
          <span className="flex flex-wrap items-center gap-1">
            <Button asChild variant="secondary" size="sm"><Link href={toHref("resumes.studio", { id: v.id }, { mode: "view" })} aria-label={`View version ${v.number} of ${title}`}>View</Link></Button>
            {onSaveAsNew && v.number > 1 ? <Button variant="ghost" size="sm" onClick={() => onSaveAsNew(v)} aria-label={`Save version ${v.number} of ${title} as a new résumé`}>Save as new résumé</Button> : null}
            {onDelete && v.number > 1 && !v.madeByLead ? (
              <Button variant="ghost" size="sm" className="hover:text-[var(--color-danger-fg)]" onClick={() => onDelete(v)} aria-label={`Delete version ${v.number} of ${title}`}>Delete</Button>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Copies made for specific jobs": one row per job, with View and Download PDF, and its older versions behind a link. */
export function JobCopies({ id, copies, labels, candidateName }: { id: string; copies: readonly TreeTailored[]; labels: TreeLabels; candidateName: string }) {
  return (
    <ul id={id} className="mt-2 space-y-2">
      {copies.map((copy) => <JobCopy key={copy.resume.id} copy={copy} labels={labels} candidateName={candidateName} />)}
    </ul>
  );
}

function JobCopy({ copy, labels, candidateName }: { copy: TreeTailored; labels: TreeLabels; candidateName: string }) {
  const toHref = useHref();
  const [isOpen, setOpen] = useState(false);
  const olderId = useId();
  const title = copyTitle(labels.job(copy.jobId));
  const [latest, ...older] = copy.versions;
  if (!latest) return null;
  return (
    <li className="rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-[550] text-[var(--color-text)]">{title}</p>
          <p className="text-caption text-[var(--color-text-2)]">{updatedLine(formatRelative(latest.createdAt), labels.userName(latest.createdByUserId), copy.versions.length)}</p>
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          <Button asChild variant="secondary" size="sm"><Link href={toHref("resumes.studio", { id: latest.id }, { mode: "view" })} aria-label={`View the copy for ${title}`}>View</Link></Button>
          <DownloadPdfButton versionId={latest.id} fileName={`${candidateName} · ${title}`} label={`Download the copy for ${title} as PDF`} />
        </span>
      </div>
      {older.length ? (
        <div className="mt-1.5">
          <Reveal label={`See older versions (${older.length})`} isOpen={isOpen} onToggle={() => setOpen(!isOpen)} controls={olderId} />
          {isOpen ? <VersionList id={olderId} versions={older} title={title} labels={labels} source="PROMOTED" /> : null}
        </div>
      ) : null}
    </li>
  );
}
