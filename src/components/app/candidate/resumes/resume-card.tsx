"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { formatRelative } from "@/lib/format/timezone";
import { useHref } from "@/lib/routes/use-href";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import type { TreeLabels } from "@/components/app/resumes/base-folder";
import { DownloadPdfButton } from "./download-pdf";
import { MoreMenu, type MoreItem } from "./more-menu";
import { copyCount, updatedLine, type ResumeCard as Card } from "./resume-cards";
import { JobCopies, Reveal, VersionList } from "./resume-versions";
import type { CardActions } from "./use-card-actions";

const SOURCE = { UPLOAD: "Started from an uploaded file", PROMOTED: "Started from a version of another résumé" } as const;

/**
 * One résumé, closed by default: its role, the "Main résumé" badge, who updated it and when, and labelled actions.
 * Older versions and the copies made for jobs open from links inside the card.
 */
export function ResumeCard({ card, labels, candidateName, actions, onMakeJobCopy }: {
  card: Card;
  labels: TreeLabels;
  candidateName: string;
  /** Absent: the person only reads (a viewer, a support view). */
  actions?: CardActions;
  onMakeJobCopy?: () => void;
}) {
  const toHref = useHref();
  const [openPart, setOpenPart] = useState<"versions" | "copies" | null>(null);
  const versionsId = useId();
  const copiesId = useId();
  const { node, title, isMain, latest, older } = card;
  const isHidden = !!node.base.archivedAt;
  const canChange = !!actions?.canChange && !isHidden;
  const canManage = !!actions?.canManage;
  const toggle = (part: "versions" | "copies") => setOpenPart(openPart === part ? null : part);

  const more: MoreItem[] = [];
  if (latest && canChange) more.push({ label: "Edit résumé", href: toHref("resumes.studio", { id: latest.id }) });
  if (canChange && !isMain) more.push({ label: "Make main résumé", onSelect: () => actions!.makeMain(node, title) });
  if (canManage && !isHidden && onMakeJobCopy) more.push({ label: "Make a copy for a job", onSelect: onMakeJobCopy });
  if (canManage && isHidden) more.push({ label: "Show on the list again", onSelect: () => actions!.showAgain(node, title) });
  if (canManage && !isMain && !isHidden && !node.base.madeByLead) more.push({ label: "Delete", tone: "danger", onSelect: () => actions!.deleteResume(node, title) });

  return (
    <li className={cn("rounded-[var(--radius-lg)] border bg-[var(--color-surface)] px-4 py-3.5", isMain ? "border-[var(--color-border-accent)]" : "border-[var(--color-border)]")}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h3 className="flex flex-wrap items-center gap-2 text-body-strong text-[var(--color-text)]">
            <span className="min-w-0 break-words">{title}</span>
            {isMain ? <Tag tone="green">Main résumé</Tag> : null}
          </h3>
          {latest ? (
            <p className="mt-0.5 text-sm text-[var(--color-text-2)]" title={SOURCE[node.base.source]}>
              {updatedLine(formatRelative(latest.createdAt), labels.userName(latest.createdByUserId), node.versions.length)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {canChange && !isMain ? <Button variant="ghost" size="sm" onClick={() => actions!.makeMain(node, title)} aria-label={`Make ${title} the main résumé`}>Make main résumé</Button> : null}
          {latest ? (
            <>
              <Button asChild variant="secondary" size="sm"><Link href={toHref("resumes.studio", { id: latest.id }, { mode: "view" })} aria-label={`View ${title}`}>View</Link></Button>
              <DownloadPdfButton versionId={latest.id} fileName={`${candidateName} · ${title}`} label={`Download ${title} as PDF`} />
            </>
          ) : null}
          <MoreMenu label={`More actions for ${title}`} items={more} />
        </div>
      </div>

      {older.length || node.tailored.length ? (
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          {older.length ? <Reveal label={`See older versions (${older.length})`} isOpen={openPart === "versions"} onToggle={() => toggle("versions")} controls={versionsId} /> : null}
          {node.tailored.length ? <Reveal label={copyCount(node.tailored)} isOpen={openPart === "copies"} onToggle={() => toggle("copies")} controls={copiesId} /> : null}
        </div>
      ) : null}
      {openPart === "versions" ? (
        <VersionList id={versionsId} versions={node.versions} title={title} labels={labels} source={node.base.source}
          onSaveAsNew={canChange ? (v) => actions!.saveAsNew(v, title) : undefined}
          onDelete={canManage ? (v) => actions!.deleteVersion(v, title) : undefined} />
      ) : null}
      {openPart === "copies" ? <JobCopies id={copiesId} copies={node.tailored} labels={labels} candidateName={candidateName} /> : null}
    </li>
  );
}
