"use client";

import { create } from "zustand";
import type { ResumeDocument, ResumeSectionKey } from "@/lib/schemas/resume-document";

export type StudioMode = "build" | "view";
export type Zoom = "fit" | number;

interface StudioState {
  doc: ResumeDocument | null;
  mode: StudioMode;
  zoom: Zoom;
  galleryOpen: boolean;
  openSections: Partial<Record<ResumeSectionKey, boolean>>;
  /** Expanded experience / list entries in the builder, by entry id. */
  openEntries: Record<string, boolean>;
  /** Edited since it was opened or saved. The design (template) is a view choice and doesn't count. */
  isDirty: boolean;
  /** After a save of v2 or later: ask "Use this as the base?" (resume-versioning.md §4.3). */
  askUseAsBase: { candidateId: string; versionId: string; number: number } | null;
  /** A notice to show once the next document has loaded (a save moves to the new version, and loading clears notices). */
  pendingNotice: { text: string; tone: "info" | "ai" | "danger" } | null;
  pageCount: number;
  notice: { text: string; tone: "info" | "ai" | "danger" } | null;
  /** Field that just changed under AI — the paper and the field flash it once. */
  flashId: string | null;
  /** Ask whichever view is showing to scroll to and focus a field. Nonce re-triggers the same id. */
  focusRequest: { fieldId: string; nonce: number } | null;

  /** `keepLayout`: the next version of what is open (after a save) keeps the sections and entries that were open. */
  load: (doc: ResumeDocument, mode: StudioMode, keepLayout?: boolean) => void;
  setAskUseAsBase: (ask: StudioState["askUseAsBase"]) => void;
  setPendingNotice: (notice: StudioState["pendingNotice"]) => void;
  setMode: (mode: StudioMode) => void;
  update: (fn: (doc: ResumeDocument) => ResumeDocument) => void;
  setTemplate: (templateId: string) => void;
  setZoom: (zoom: Zoom) => void;
  setGalleryOpen: (open: boolean) => void;
  toggleSection: (key: ResumeSectionKey, open?: boolean) => void;
  toggleEntry: (id: string, open?: boolean) => void;
  flash: (fieldId: string) => void;
  requestFocus: (fieldId: string) => void;
  setPageCount: (pages: number) => void;
  notify: (text: string, tone?: "info" | "ai" | "danger") => void;
}

export const useStudio = create<StudioState>((set) => ({
  doc: null,
  mode: "build",
  zoom: "fit",
  galleryOpen: false,
  openSections: { header: true },
  openEntries: {},
  isDirty: false,
  askUseAsBase: null,
  pendingNotice: null,
  pageCount: 1,
  notice: null,
  flashId: null,
  focusRequest: null,

  load: (doc, mode, keepLayout = false) => set((s) => ({ doc, mode, isDirty: false, galleryOpen: false, openSections: keepLayout ? s.openSections : { header: true }, openEntries: keepLayout ? s.openEntries : {}, flashId: null, focusRequest: null, notice: null })),
  setMode: (mode) => set({ mode }),
  setAskUseAsBase: (askUseAsBase) => set({ askUseAsBase }),
  setPendingNotice: (pendingNotice) => set({ pendingNotice }),
  update: (fn) => set((s) => (s.doc ? { doc: fn(s.doc), isDirty: true } : s)),
  setTemplate: (templateId) => set((s) => (s.doc ? { doc: { ...s.doc, templateId } } : s)),
  setZoom: (zoom) => set({ zoom }),
  setGalleryOpen: (galleryOpen) => set({ galleryOpen }),
  toggleSection: (key, open) =>
    set((s) => ({ openSections: { ...s.openSections, [key]: open ?? !s.openSections[key] } })),
  toggleEntry: (id, open) => set((s) => ({ openEntries: { ...s.openEntries, [id]: open ?? !s.openEntries[id] } })),
  flash: (fieldId) => {
    set({ flashId: fieldId });
    setTimeout(() => set((s) => (s.flashId === fieldId ? { flashId: null } : s)), 1800);
  },
  requestFocus: (fieldId) => set({ focusRequest: { fieldId, nonce: Date.now() } }),
  setPageCount: (pageCount) => set({ pageCount }),
  notify: (text, tone = "info") => {
    const notice = { text, tone };
    set({ notice });
    setTimeout(() => set((s) => (s.notice === notice ? { notice: null } : s)), 4500);
  },
}));
