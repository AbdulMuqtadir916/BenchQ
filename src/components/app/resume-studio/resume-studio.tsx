"use client";


import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/lib/motion";
import { BuilderPanel } from "./builder/builder-panel";
import { PreviewPane } from "./preview/preview-pane";
import { StudioTopbar } from "./studio-topbar";
import { StatusBar } from "./status-bar";
import { ViewerOutline } from "./viewer-outline";
import { SelectionToolbar } from "./selection-toolbar";
import { useTailorRun } from "./tailor-run";
import { usePrintExport } from "./print-export";
import { stepTemplate } from "./templates";
import { useStudio, type StudioTab } from "./studio-store";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { AutofillTab } from "@/components/app/resume-autofill/autofill-tab";
import { hasUnsavedAnswers } from "@/components/app/resume-autofill/use-unsaved-answers";
import type { ResumeSectionKey } from "@/lib/schemas/resume-document";
import { normalizeProfileLink } from "@/lib/resume-doc/profile-link";
import { resumeFileName } from "@/lib/derive/resume-name";

/** True when a key press belongs to a text field rather than to the studio. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** A saved version's three tabs, as URLs (07 Q13). */
export type StudioHrefs = { build: string; view: string; autofill: string };

/** The studio's tabs are two pages, so a switch remounts the studio: it shouldn't play its opening again. */
let lastShown: { id: string; at: number } | null = null;
const SWITCH_MS = 1500;

/**
 * The full-screen resume workspace — no app sidebar or top nav, so the page
 * gets all the room. Builder mode: section forms left, live page right.
 * Viewer mode: the page itself, editable in place. Autofill answers (its own route, `isAutofill`): what the extension
 * fills from this version. A switch to or from it replaces the URL, so closing goes back to where the studio was opened.
 */
export function ResumeStudio({ name, subtitle, canEdit, canTailor, onClose, onSave, isSaving = false, isAutofill = false, hrefs }: {
  name: string; subtitle: string; canEdit: boolean; canTailor: boolean; onClose: () => void; onSave?: () => void;
  isSaving?: boolean; isAutofill?: boolean;
  /** Absent for an unsaved draft, which has no Autofill tab. */
  hrefs?: StudioHrefs;
}) {
  const doc = useStudio((s) => s.doc);
  const mode = useStudio((s) => s.mode);
  const setMode = useStudio((s) => s.setMode);
  const router = useRouter();
  const tab: StudioTab = isAutofill ? "autofill" : mode;
  const rootRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;
  const [isOpening] = useState(() => {
    const id = useStudio.getState().doc?.resumeId;
    return !(lastShown && id && lastShown.id === id && Date.now() - lastShown.at < SWITCH_MS);
  });
  useEffect(() => () => {
    const id = useStudio.getState().doc?.resumeId;
    if (id) lastShown = { id, at: Date.now() };
  }, []);
  const tailor = useTailorRun();
  const exporter = usePrintExport(doc, resumeFileName(name));
  const [isConfirmingClose, setConfirmingClose] = useState(false);
  // Leaving the Autofill tab (another tab, Close, Esc) drops an answer being written there, which isn't the document's,
  // so the discard check below can't see it: ask first, then leave.
  const [leaveAnswer, setLeaveAnswer] = useState<(() => void) | null>(null);
  const leaveAutofill = useCallback((leave: () => void) => {
    if (isAutofill && hasUnsavedAnswers()) setLeaveAnswer(() => leave);
    else leave();
  }, [isAutofill]);
  // Closing with unsaved edits asks first: a save is explicit (no autosave), so closing would lose them.
  const close = useCallback(() => leaveAutofill(() => (useStudio.getState().isDirty && onSave ? setConfirmingClose(true) : onClose())),
    [leaveAutofill, onClose, onSave]);
  const selectTab = useCallback((next: StudioTab) => {
    if (next === tab) return;
    if (next === "autofill") {
      if (hrefs) router.replace(hrefs.autofill, { scroll: false });
      return;
    }
    leaveAutofill(() => {
      setMode(next);
      if (isAutofill && hrefs) router.replace(next === "view" ? hrefs.view : hrefs.build, { scroll: false });
    });
  }, [tab, hrefs, isAutofill, router, setMode, leaveAutofill]);
  // A list of records on the Autofill tab (the work history…) is changed in the Builder: its section opens there.
  const editInBuilder = useCallback((section: ResumeSectionKey) => {
    useStudio.getState().toggleSection(section, true);
    selectTab("build");
  }, [selectTab]);

  const hasInvalidLinks = !!doc && [doc.header.linkedin, doc.header.github].some((value) => normalizeProfileLink(value) === null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canEdit && onSave && !hasInvalidLinks && !isSaving && useStudio.getState().isDirty) onSave();
        return;
      }
      // A dialog on top (discard, "Use this as the base?") answers its own Esc; the studio stays open.
      if (e.defaultPrevented || isTyping(e.target) || document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        // Claim the key: the browser would otherwise take this same Esc as "cancel" for the discard dialog it opens.
        e.preventDefault();
        close();
      }
      if ((e.key === "[" || e.key === "]") && !isAutofill) {
        const { doc: current, setTemplate } = useStudio.getState();
        if (current) setTemplate(stepTemplate(current.templateId, e.key === "]" ? 1 : -1).id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, canEdit, onSave, hasInvalidLinks, isSaving, isAutofill]);

  if (!doc) return null;
  const isEditable = canEdit && mode === "view";

  return (
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      initial={reduce || !isOpening ? false : { opacity: 0, scale: 0.985, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.26, ease: EASE_OUT }}
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)]"
    >
      <StudioTopbar
        doc={doc}
        name={name}
        subtitle={subtitle}
        canEdit={canEdit}
        canTailor={canTailor}
        isTailoring={tailor.isRunning}
        onSave={onSave}
        isSaving={isSaving}
        isSaveBlocked={hasInvalidLinks}
        onClose={close}
        onTailor={tailor.start}
        onExport={exporter.print}
        tab={tab}
        onTab={selectTab}
        hasAutofill={Boolean(hrefs)}
      />

      <div className="flex min-h-0 flex-1">
        {isAutofill ? (
          <AutofillTab versionId={doc.resumeId} canEdit={canEdit} onEditInBuilder={editInBuilder} />
        ) : mode === "build" ? (
          <>
            <div className="w-full shrink-0 overflow-y-auto bg-[var(--color-bg-subtle)] p-3 sm:p-4 lg:w-[44%] lg:max-w-2xl lg:border-r lg:border-[var(--color-border)]">
              {canEdit ? <BuilderPanel doc={doc} /> : <p className="p-4 text-body text-[var(--color-text-3)]">You have view-only access to this resume.</p>}
            </div>
            <div className="hidden min-w-0 flex-1 lg:flex">
              <PreviewPane doc={doc} />
            </div>
          </>
        ) : (
          <>
            <ViewerOutline doc={doc} />
            <PreviewPane doc={doc} editable={isEditable} />
          </>
        )}
      </div>

      <StatusBar doc={doc} showWords={!isAutofill} />
      {!isAutofill && (isEditable || (canEdit && mode === "build")) ? <SelectionToolbar scopeRef={rootRef} /> : null}
      {tailor.panel}
      {exporter.portal}
      <ConfirmDialog open={isConfirmingClose} title="Discard unsaved changes?" confirmLabel="Discard" tone="danger" cancelLabel="Keep editing"
        onCancel={() => setConfirmingClose(false)} onConfirm={() => { setConfirmingClose(false); onClose(); }}>
        <p>Your edits since the last save are lost. Save first to keep them as the next version.</p>
      </ConfirmDialog>
      <ConfirmDialog open={leaveAnswer !== null} title="Discard the unsaved answer?" confirmLabel="Discard" tone="danger" cancelLabel="Keep editing"
        onCancel={() => setLeaveAnswer(null)} onConfirm={() => { const leave = leaveAnswer; setLeaveAnswer(null); leave?.(); }}>
        <p>The answer you&apos;re writing on the Autofill tab isn&apos;t saved yet. Save it first to keep it.</p>
      </ConfirmDialog>
    </motion.div>
  );
}
