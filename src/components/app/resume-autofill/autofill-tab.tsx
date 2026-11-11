"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { z } from "zod";
import { CircleAlert, Info } from "lucide-react";
import { ErrorState } from "@/components/app/error-state";
import { NotFoundState } from "@/components/app/not-found-state";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/components/app/resume-studio/studio-store";
import { ApiError, isNotFoundError } from "@/lib/api/client";
import { autofillSections, summarize, type AutofillShow } from "@/lib/derive/autofill-view";
import { useResumeAutofill, useSaveResumeAutofill } from "@/lib/hooks/use-resume-autofill";
import { useHref } from "@/lib/routes/use-href";
import { useUrlState } from "@/lib/routes/use-url-state";
import type { ResumeSectionKey } from "@/lib/schemas/resume-document";
import type { SaveAutofill } from "./autofill-row";
import { AutofillRail } from "./autofill-rail";
import { AutofillSectionCard } from "./autofill-section";
import { AutofillSkeleton } from "./autofill-skeleton";
import { AutofillToolbar } from "./autofill-toolbar";

/** The filter and the search, in the URL (CLAUDE.md): a stale or hand-typed value falls back to the open list. */
const AutofillView = z.object({
  show: z.enum(["all", "missing", "review", "yours"]).catch("all"),
  q: z.string().catch(""),
});

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

type AutofillTabProps = {
  versionId: string;
  /** `canChangeResume`, as saving the résumé: a viewer and a support view only read. */
  canEdit: boolean;
  /** A list of records (the work history…) is changed in the Builder: this opens its section there. */
  onEditInBuilder: (section: ResumeSectionKey) => void;
};

/**
 * The studio's Autofill answers tab (docs/04, 07 Q6, Q13): what the extension fills on application forms from this
 * résumé version, every question once, by topic. BenchQ's answers come from the résumé and the profile; the user's
 * replace them on this version only (decided 2026-11-11: never on the résumé's other versions). A save's outcome shows
 * in the studio's status bar. `J` / `K` move through the questions, Enter edits one, `/` searches, Esc cancels an edit
 * and otherwise closes the studio.
 */
export function AutofillTab({ versionId, canEdit, onEditInBuilder }: AutofillTabProps) {
  const toHref = useHref();
  const autofillQuery = useResumeAutofill(versionId);
  const saving = useSaveResumeAutofill(versionId);
  const notify = useStudio((s) => s.notify);
  const isDirty = useStudio((s) => s.isDirty);
  const [view, setView] = useUrlState(AutofillView);
  const [search, setSearch] = useState(view.q);
  const [isStale, setIsStale] = useState(false);
  // One of BenchQ's questions picked from Add a question: its row opens its editor (the list shows every question).
  const [openKey, setOpenKey] = useState<string | null>(null);
  const pickQuestion = useCallback((key: string) => {
    setSearch("");
    setView({ show: "all", q: "" });
    setOpenKey(key);
    requestAnimationFrame(() => document.querySelector(`[data-autofill-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "center" }));
  }, [setView]);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The search reaches the URL once typing pauses, so each key doesn't replace the page's address.
  useEffect(() => {
    if (search === view.q) return;
    const timer = window.setTimeout(() => setView({ q: search }), 250);
    return () => window.clearTimeout(timer);
  }, [search, view.q, setView]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const candidateId = autofillQuery.data?.candidateId;
  const onSave = useCallback<SaveAutofill>(async (build) => {
    if (!candidateId) return false;
    try {
      await saving.mutateAsync({ candidateId, change: build(true) });
      notify("Saved to this version.");
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setIsStale(true);
      notify(error instanceof Error ? error.message : "The save didn't go through. Try again.", "danger");
      return false;
    }
  }, [candidateId, notify, saving]);

  const entries = autofillQuery.data?.entries;
  const summary = useMemo(() => summarize(entries ?? []), [entries]);
  const sections = useMemo(() => autofillSections(entries ?? [], view.show, view.q), [entries, view.show, view.q]);

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || (event.key !== "j" && event.key !== "k")) return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-autofill-nav]") ?? []);
    if (!rows.length) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    rows[event.key === "j" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1)]?.focus();
  };

  if (isNotFoundError(autofillQuery.error)) {
    return <Scroll><NotFoundState title="Autofill answers not found" description="This resume version doesn't exist or isn't available to you." backHref={toHref("resumes")} backLabel="Back to resumes" /></Scroll>;
  }
  if (autofillQuery.error) {
    return <Scroll><div className="mx-auto w-full max-w-3xl p-4"><ErrorState variant="page" error={autofillQuery.error} onRetry={() => void autofillQuery.refetch()} /></div></Scroll>;
  }
  if (!autofillQuery.data) return <Scroll><AutofillSkeleton /></Scroll>;

  const rowProps = { canEdit, isSaving: saving.isPending, onSave, onEditInBuilder, openKey, onOpened: () => setOpenKey(null), onPickQuestion: pickQuestion };
  const isFiltered = view.show !== "all" || view.q.trim() !== "";
  return (
    <Scroll>
      <div className="mx-auto flex w-full max-w-6xl gap-8 px-4 pb-10 pt-5 sm:px-6">
        <AutofillRail sections={sections} />
        <div ref={listRef} onKeyDown={onListKey} className="min-w-0 flex-1 space-y-4">
          <AutofillToolbar summary={summary} show={view.show} onShow={(show: AutofillShow) => setView({ show })} search={search} onSearch={setSearch}
            searchRef={searchRef} />
          {isDirty ? (
            <Note tone="info">This resume has unsaved changes. These answers come from the last saved version: save to see your changes here.</Note>
          ) : null}
          {isStale ? (
            <Note tone="danger" action={<Button size="sm" variant="secondary" onClick={() => { setIsStale(false); void autofillQuery.refetch(); }}>Reload</Button>}>
              An answer changed since you opened this page. Reload to see the latest, then make your change again.
            </Note>
          ) : null}
          {!canEdit ? <Note tone="info">You can view these answers. The candidate&apos;s BDE changes them.</Note> : null}
          {sections.length > 0 ? sections.map((section) => (
            <AutofillSectionCard key={section.id} section={section} entries={autofillQuery.data.entries} {...rowProps} />
          )) : (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] px-4 py-10 text-center">
              <p className="text-body-strong text-[var(--color-text)]">{emptyTitle(view.show, view.q)}</p>
              {isFiltered ? (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => { setSearch(""); setView({ show: "all", q: "" }); }}>Show every question</Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </Scroll>
  );
}

function emptyTitle(show: AutofillShow, query: string): string {
  if (query.trim()) return `No question matches “${query.trim()}”.`;
  if (show === "missing") return "Every question has an answer.";
  if (show === "review") return "Nothing needs a look.";
  if (show === "yours") return "You haven't changed or added an answer yet.";
  return "No questions yet.";
}

function Scroll({ children }: { children: React.ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface)]">{children}</div>;
}

function Note({ tone, action, children }: { tone: "info" | "danger"; action?: React.ReactNode; children: React.ReactNode }) {
  const Icon = tone === "danger" ? CircleAlert : Info;
  return (
    <div role={tone === "danger" ? "alert" : "status"}
      className={tone === "danger"
        ? "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-md)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]"
        : "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-2)]"}>
      <Icon size={14} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}
