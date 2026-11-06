"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpFromLine, Briefcase, CircleCheck, ChevronRight, Eye, FileCheck2, FileUser, Trash2 } from "lucide-react";
import type { BaseResume } from "@/lib/schemas/resume";
import { baseSummary, type TreeBase, type TreeTailored, type TreeVersion } from "@/lib/derive/resume-tree";
import { baseName, roleOf, tailoredName, versionName } from "@/lib/derive/resume-name";
import { formatRelative } from "@/lib/format/timezone";
import { useHref } from "@/lib/routes/use-href";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui/tag";

export interface TreeLabels {
  job: (jobId: string) => { company: string; title: string } | null;
  candidate: (candidateId: string) => { name: string; role: string | null } | null;
  userName: (userId: string) => string | null;
}

/** What a person may do from the tree (07 Q55), and the handlers. Absent: the tree only reads. */
export interface TreeActions {
  canChange: (candidateId: string) => boolean;
  canManage: (candidateId: string) => boolean;
  onPickBase: (node: TreeBase) => void;
  onUseAsBase: (candidateId: string, version: TreeVersion) => void;
  onDeleteBase: (node: TreeBase, label: string) => void;
  onDeleteVersion: (candidateId: string, version: TreeVersion, label: string) => void;
  onShowBase: (node: TreeBase) => void;
}

function IconAction({ label, onClick, children, tone }: { label: string; onClick: () => void; children: React.ReactNode; tone?: "danger" }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-3)] hover:bg-[var(--color-surface-2)]", tone === "danger" ? "hover:text-[var(--color-danger-fg)]" : "hover:text-[var(--color-text)]")}>
      {children}
    </button>
  );
}

const SOURCE: Record<BaseResume["source"], string> = { UPLOAD: "Uploaded", PROMOTED: "From a version", MANUAL: "From the form" };

function Disclosure({ isOpen, onToggle, controls, children }: { isOpen: boolean; onToggle: () => void; controls: string; children: React.ReactNode }) {
  return (
    <button type="button" data-tree-nav="" aria-expanded={isOpen} aria-controls={controls} onClick={onToggle}
      className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] px-3 text-left hover:bg-[var(--color-surface-2)]">
      <ChevronRight size={14} aria-hidden className={cn("shrink-0 text-[var(--color-text-3)] transition-transform duration-[var(--duration-base)]", isOpen && "rotate-90")} />
      {children}
    </button>
  );
}

/** One version: opens in Builder mode; View opens it in Viewer mode. */
function VersionRow({ version, label, labels, extra }: { version: TreeVersion; label: string; labels: TreeLabels; extra?: React.ReactNode }) {
  const toHref = useHref();
  const by = labels.userName(version.createdByUserId);
  return (
    <li className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5 hover:bg-[var(--color-surface-2)]">
      <Link href={toHref("resumes.studio", { id: version.id })} data-tree-nav="" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-[var(--color-text)] hover:underline">
        <span className="tabular font-[550]">v{version.number}</span>
        {version.isLatest ? <Tag tone="green">Latest</Tag> : null}
        <span className="truncate text-caption text-[var(--color-text-2)]">{[by ? `by ${by}` : null, formatRelative(version.createdAt)].filter(Boolean).join(" · ")}</span>
        <span className="sr-only">{versionName(label, version.number)}</span>
      </Link>
      <Link href={toHref("resumes.studio", { id: version.id }, { mode: "view" })} aria-label={`View ${versionName(label, version.number)}`}
        className="bq-secondary inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-md)] px-2 text-caption">
        <Eye size={12} aria-hidden />View
      </Link>
      {extra}
    </li>
  );
}

function TailoredRow({ item, labels, actions, candidateId }: { item: TreeTailored; labels: TreeLabels; actions?: TreeActions; candidateId: string }) {
  const [isOpen, setOpen] = useState(false);
  const job = tailoredName(labels.candidate(candidateId)?.name, labels.job(item.jobId));
  const bodyId = `tailored-${item.resume.id}`;
  return (
    <li>
      <Disclosure isOpen={isOpen} onToggle={() => setOpen(!isOpen)} controls={bodyId}>
        <FileCheck2 size={14} aria-hidden className="shrink-0 text-[var(--color-info-fg)]" />
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text)]">{job}</span>
        <span className="tabular shrink-0 text-caption text-[var(--color-text-2)]">v{item.versions[0]?.number ?? 1}</span>
      </Disclosure>
      {isOpen ? (
        <ul id={bodyId} className="ml-6 border-l border-[var(--color-border)] pl-2">
          {item.versions.map((v) => (
            <VersionRow key={v.id} version={v} label={job} labels={labels}
              extra={actions?.canManage(candidateId) ? <IconAction label={`Delete ${versionName(job, v.number)}`} tone="danger" onClick={() => actions.onDeleteVersion(candidateId, v, job)}><Trash2 size={13} aria-hidden /></IconAction> : null} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** A base as a folder: its versions, newest first, then the copies tailored from it, one per job. */
export function BaseFolder({ node, labels, showTailored, defaultOpen = false, actions }: { node: TreeBase; labels: TreeLabels; showTailored: boolean; defaultOpen?: boolean; actions?: TreeActions }) {
  const [isOpen, setOpen] = useState(defaultOpen);
  const bodyId = `base-${node.base.id}`;
  const cid = node.base.candidateId;
  const who = labels.candidate(cid);
  const title = baseName(who?.name, roleOf(node.resume?.name, who?.role), node.number);
  const canChange = !!actions?.canChange(cid);
  const canManage = !!actions?.canManage(cid);
  const isHidden = !!node.base.archivedAt;
  return (
    <li className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-1 pr-2">
      <Disclosure isOpen={isOpen} onToggle={() => setOpen(!isOpen)} controls={bodyId}>
        <FileUser size={15} aria-hidden className="shrink-0 text-[var(--color-primary-subtle-fg)]" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate text-body-strong text-[var(--color-text)]">{title}</span>
            {node.base.isActive ? <Tag tone="blue">Active</Tag> : null}
            {node.base.archivedAt ? <Tag>Hidden</Tag> : null}
            <Tag>{(node.base.hasResume ? SOURCE[node.base.source] : "No résumé yet")}</Tag>
          </span>
          <span className="block text-caption text-[var(--color-text-2)]">{baseSummary(node)}</span>
        </span>
      </Disclosure>
      {canChange && !node.base.isActive && !isHidden ? <IconAction label={`Use ${title} as the base in use`} onClick={() => actions!.onPickBase(node)}><CircleCheck size={14} aria-hidden /></IconAction> : null}
      {canManage && isHidden ? <IconAction label={`Show ${title} again`} onClick={() => actions!.onShowBase(node)}><Eye size={14} aria-hidden /></IconAction> : null}
      {canManage && !node.base.isActive && !isHidden ? <IconAction label={`Delete ${title}`} tone="danger" onClick={() => actions!.onDeleteBase(node, title)}><Trash2 size={14} aria-hidden /></IconAction> : null}
      </div>
      {isOpen ? (
        <div id={bodyId} className="space-y-2 px-2 pb-2">
          <section aria-label={`${title} versions`}>
            <p className="px-3 pt-1 text-label text-[var(--color-text-3)]">Versions</p>
            {node.versions.length ? (
              <ul>{node.versions.map((v) => (
                <VersionRow key={v.id} version={v} label={title} labels={labels} extra={
                  <>
                    {canChange && v.number > 1 && !isHidden ? <IconAction label={`Use ${versionName(title, v.number)} as the base`} onClick={() => actions!.onUseAsBase(cid, v)}><ArrowUpFromLine size={13} aria-hidden /></IconAction> : null}
                    {canManage && v.number > 1 ? <IconAction label={`Delete ${versionName(title, v.number)}`} tone="danger" onClick={() => actions!.onDeleteVersion(cid, v, title)}><Trash2 size={13} aria-hidden /></IconAction> : null}
                  </>
                } />
              ))}</ul>
            ) : <p className="px-3 py-1.5 text-sm text-[var(--color-text-3)]">No versions left.</p>}
          </section>
          {showTailored ? (
            <section aria-label={`Tailored from ${title}`}>
              <p className="flex items-center gap-1.5 px-3 pt-1 text-label text-[var(--color-text-3)]"><Briefcase size={12} aria-hidden />Tailored</p>
              {node.tailored.length ? (
                <ul>{node.tailored.map((t) => <TailoredRow key={t.resume.id} item={t} labels={labels} actions={actions} candidateId={cid} />)}</ul>
              ) : <p className="px-3 py-1.5 text-sm text-[var(--color-text-3)]">No copies tailored from this base yet.</p>}
            </section>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
