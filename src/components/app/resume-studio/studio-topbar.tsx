"use client";

import { CircleDot, CloudCheck, Download, FileCheck2, FileUser, LoaderCircle, Save, Sparkles, X } from "lucide-react";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { useStudio } from "./studio-store";
import { ModeSwitch } from "./mode-switch";

interface StudioTopbarProps {
  doc: ResumeDocument;
  /** The résumé's name by the convention (src/lib/derive/resume-name.ts). */
  name: string;
  subtitle: string;
  /** May edit and save (07 Q55 `canChangeResume`): the BDE once assigned; before that the OWNER and the candidate's MANAGER. */
  canEdit: boolean;
  /** May tailor (07 Q55 `canManageResume`): only the candidate's assigned BDE, never the owner or manager. */
  canTailor: boolean;
  isTailoring: boolean;
  /** Saving makes the next version (§4.3). Absent where there is nothing to save to (a new, unsaved draft). */
  isSaveBlocked?: boolean;
  onSave?: () => void;
  isSaving?: boolean;
  onClose: () => void;
  onTailor: () => void;
  onExport: () => void;
}

export function StudioTopbar({ doc, name, subtitle, canEdit, canTailor, isTailoring, onSave, isSaving = false, isSaveBlocked = false, onClose, onTailor, onExport }: StudioTopbarProps) {
  const Icon = doc.isMaster ? FileUser : FileCheck2;

  return (
    <header className="grid min-h-14 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <button type="button" onClick={onClose} aria-label="Close resume" title="Close  Esc" className="bq-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)]">
          <X size={15} aria-hidden />
        </button>
        <span className="h-5 w-px shrink-0 bg-[var(--color-border)]" aria-hidden />
        <span aria-hidden className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)] sm:inline-flex">
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <input
              value={name}
              readOnly
              aria-label="Resume name"
              title={name}
              className="min-w-0 max-w-64 truncate lg:max-w-md rounded-[var(--radius-sm)] bg-transparent px-1 text-h3 text-[var(--color-text)] hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)]"
            />
            <Tag tone={doc.isMaster ? "blue" : "teal"} className="hidden sm:inline-flex">{doc.isMaster ? "Base" : "Tailored"}</Tag>
          </div>
          <p className="hidden truncate px-1 text-caption text-[var(--color-text-3)] md:block">{subtitle}</p>
        </div>
      </div>

      <ModeSwitch />

      <div className="flex min-w-0 items-center justify-end gap-2">
        {canEdit && onSave ? <SaveControl onSave={onSave} isSaving={isSaving} isSaveBlocked={isSaveBlocked} /> : null}
        {canTailor ? (
          <Button variant="secondary" size="sm" onClick={onTailor} disabled={isTailoring} className="hidden md:inline-flex">
            {isTailoring ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
            Tailor with AI
          </Button>
        ) : null}
        <Button size="sm" onClick={onExport} title="Download as PDF">
          <Download size={14} aria-hidden />
          <span className="hidden sm:inline">Export PDF</span>
        </Button>
      </div>
    </header>
  );
}

/** Save: each save is the résumé's next version (no autosave); the state beside it says whether anything is unsaved. */
function SaveControl({ onSave, isSaving, isSaveBlocked }: { onSave: () => void; isSaving: boolean; isSaveBlocked: boolean }) {
  const isDirty = useStudio((s) => s.isDirty);
  return (
    <>
      <span className="hidden items-center gap-1.5 text-sm text-[var(--color-text-3)] lg:inline-flex" aria-live="polite">
        {isSaving ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : isDirty ? <CircleDot size={13} aria-hidden className="text-[var(--color-warning-fg)]" /> : <CloudCheck size={14} aria-hidden />}
        {isSaving ? "Saving…" : isDirty ? "Unsaved changes" : "Saved"}
      </span>
      <Button variant="secondary" size="sm" onClick={onSave} disabled={!isDirty || isSaving || isSaveBlocked} title="Save as the next version  ⌘S">
        <Save size={14} aria-hidden />
        <span className="hidden sm:inline">Save</span>
      </Button>
    </>
  );
}
