"use client";

import { CircleDot, CloudCheck, Download, FileCheck2, FileUser, LoaderCircle, Save, Sparkles, X } from "lucide-react";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { useStudio, type StudioTab } from "./studio-store";
import { StudioTabs } from "./studio-tabs";

interface StudioTopbarProps {
  doc: ResumeDocument;
  /** The résumé's name by the convention (src/lib/derive/resume-name.ts). */
  name: string;
  subtitle: string;
  canEdit: boolean;
  isTailoring: boolean;
  /** Saving makes the next version (§4.3). Absent where there is nothing to save to (a new, unsaved draft). */
  onSave?: () => void;
  isSaving?: boolean;
  onClose: () => void;
  onTailor: () => void;
  onExport: () => void;
  tab: StudioTab;
  onTab: (tab: StudioTab) => void;
  /** A saved version has an Autofill tab (07 Q13); a new, unsaved draft doesn't. */
  hasAutofill: boolean;
}

/**
 * The studio's bar: the résumé on the left, its tabs in the middle, the actions on the right (docs/04). The two sides
 * share the room the tabs leave, so the tabs sit in the middle; the actions never shrink below their content and the
 * name gives way first, so nothing overlaps. Labels fold into their icons as the window narrows, keeping their names as
 * accessible names. The Autofill tab keeps Save (a draft may be waiting); Tailor and Export act on the page, so they
 * stay with the Builder and the Viewer.
 */
export function StudioTopbar({ doc, name, subtitle, canEdit, isTailoring, onSave, isSaving = false, onClose, onTailor, onExport, tab, onTab, hasAutofill }: StudioTopbarProps) {
  const Icon = doc.isMaster ? FileUser : FileCheck2;
  const isOnPage = tab !== "autofill";

  return (
    <header className="flex min-h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 sm:px-4">
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-2.5">
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
            <Tag tone={doc.isMaster ? "blue" : "teal"} className="hidden shrink-0 sm:inline-flex">{doc.isMaster ? "Base" : "Tailored"}</Tag>
          </div>
          <p className="hidden truncate px-1 text-caption text-[var(--color-text-3)] md:block">{subtitle}</p>
        </div>
      </div>

      <StudioTabs tab={tab} onTab={onTab} hasAutofill={hasAutofill} />

      <div className="flex flex-1 basis-0 items-center justify-end gap-2">
        {canEdit && onSave ? <SaveControl onSave={onSave} isSaving={isSaving} /> : null}
        {canEdit && isOnPage ? (
          <Button variant="secondary" size="sm" onClick={onTailor} disabled={isTailoring} aria-label="Tailor with AI" title="Tailor with AI" className="hidden shrink-0 md:inline-flex">
            {isTailoring ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
            <span className="hidden xl:inline">Tailor with AI</span>
          </Button>
        ) : null}
        {isOnPage ? (
          <Button size="sm" onClick={onExport} aria-label="Export PDF" title="Download as PDF" className="shrink-0">
            <Download size={14} aria-hidden />
            <span className="hidden lg:inline">Export PDF</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

/** Save: each save is the résumé's next version (no autosave); the state beside it says whether anything is unsaved. */
function SaveControl({ onSave, isSaving }: { onSave: () => void; isSaving: boolean }) {
  const isDirty = useStudio((s) => s.isDirty);
  return (
    <>
      <span className="hidden shrink-0 items-center gap-1.5 text-sm text-[var(--color-text-3)] lg:inline-flex" aria-live="polite">
        {isSaving ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : isDirty ? <CircleDot size={13} aria-hidden className="text-[var(--color-warning-fg)]" /> : <CloudCheck size={14} aria-hidden />}
        {isSaving ? "Saving…" : isDirty ? "Unsaved changes" : "Saved"}
      </span>
      <Button variant="secondary" size="sm" onClick={onSave} disabled={!isDirty || isSaving} aria-label="Save" title="Save as the next version  ⌘S" className="shrink-0">
        <Save size={14} aria-hidden />
        <span className="hidden sm:inline">Save</span>
      </Button>
    </>
  );
}
