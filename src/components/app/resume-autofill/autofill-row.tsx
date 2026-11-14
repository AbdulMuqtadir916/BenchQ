"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { editChange, isEditable, keepMineChange, removeChange, resetChange } from "@/lib/derive/autofill";
import { ANSWER_SUGGESTIONS, builderSectionOf, displayAnswer, draftRowOf, sourceOf, statusOf } from "@/lib/derive/autofill-view";
import type { AutofillAnswer, AutofillChange, AutofillEntry } from "@/lib/schemas/resume-autofill";
import type { ResumeSectionKey } from "@/lib/schemas/resume-document";
import { AnswerEditor } from "./answer-editor";
import { AnswerView } from "./answer-view";

/** Saves a change, given whether it's for this version only; true once saved. */
export type SaveAutofill = (build: (onlyThis: boolean) => AutofillChange) => Promise<boolean>;

type AutofillRowProps = {
  entry: AutofillEntry;
  /** The version's whole list, which says where some answers come from. */
  entries: readonly AutofillEntry[];
  canEdit: boolean;
  isSaving: boolean;
  onSave: SaveAutofill;
  onEditInBuilder: (section: ResumeSectionKey) => void;
  /** Picked from Add a question: the row shows its editor until it's saved or cancelled. */
  isOpened?: boolean;
  onOpened?: () => void;
};

const FROM = { resume: "From the resume", profile: "From the candidate's profile", "work-history": "Counted from the work history", "self-id": "", ask: "" } as const;
const UNKNOWN = {
  resume: "The resume doesn't say.", profile: "The profile doesn't say.", "work-history": "No dated job to count from.",
  "self-id": "Voluntary: add it only if the candidate chose to share it.", ask: "Ask the candidate.",
} as const;
/** An answer only the BDE adds (nothing holds it): its edit is the answer, so Reset removes it. */
const OWN_ANSWER = { "self-id": "The candidate's own answer, shared voluntarily", ask: "Added for this version" } as const;
const isOwnAnswer = (source: ReturnType<typeof sourceOf>): source is keyof typeof OWN_ANSWER => source === "self-id" || source === "ask";

/**
 * One question and its answer (docs/04 Autofill tab): BenchQ's, with where it comes from; the user's, with BenchQ's
 * under it and Reset; one the résumé or profile replaced (07 Q15: Keep mine / Use the new one); one with no answer yet
 * (Add an answer); or a question of the user's own (Edit, Delete). A list of records is changed in the Builder (07 Q42).
 * `J` / `K` reach the row; Enter opens its editor.
 */
export function AutofillRow({ entry, entries, canEdit, isSaving, onSave, onEditInBuilder, isOpened = false, onOpened }: AutofillRowProps) {
  const [isEditingHere, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const status = statusOf(entry);
  const mayEdit = canEdit && isEditable(entry);
  const isEditing = isEditingHere || (isOpened && mayEdit);
  const section = builderSectionOf(entry);
  const source = sourceOf(entry, entries);
  // A closed editor hands the focus back to its row, so J / K carry on from there.
  const closeEditor = () => {
    setIsEditing(false);
    onOpened?.();
    requestAnimationFrame(() => rowRef.current?.focus());
  };
  const save = (build: (onlyThis: boolean) => AutofillChange) => void onSave(build).then((saved) => { if (saved) closeEditor(); });
  const saveAnswer = (answer: AutofillAnswer) =>
    save((onlyThis) => (entry.kind === "CUSTOM"
      ? { edit: {}, built: {}, reset: [], add: { [entry.question]: String(answer) }, remove: [], onlyThis }
      : editChange(entry, answer, onlyThis)));
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.target === event.currentTarget && event.key === "Enter" && mayEdit && !isEditing && status !== "review") {
      event.preventDefault();
      setIsEditing(true);
    }
  };

  return (
    <li ref={rowRef} data-autofill-nav="" data-autofill-key={entry.key ?? undefined} tabIndex={-1} onKeyDown={onKeyDown}
      className="bq-focus-target px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-primary-subtle)] motion-reduce:transition-none">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {/* The actions wrap under the question when it would get narrower than this, as on a phone. */}
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-sm text-[var(--color-text-2)]">{entry.question}</p>
          {!isEditing ? <AnswerView answerKey={entry.key} answer={entry.answer} /> : null}
          {status === "review" ? (
            <p className="mt-1 text-sm text-[var(--color-warning-fg)]">
              Your answer “{displayAnswer(entry.key, entry.replaced) ?? "none"}” was replaced when the {source === "profile" ? "profile" : "resume"} changed it to “{displayAnswer(entry.key, entry.answer) ?? "none"}”.
            </p>
          ) : null}
          {status === "edited" && isOwnAnswer(source) ? <p className="mt-1 text-caption text-[var(--color-text-3)]">{OWN_ANSWER[source]}</p> : null}
          {status === "edited" && !isOwnAnswer(source) ? <p className="mt-1 text-caption text-[var(--color-text-3)]">BenchQ&apos;s answer: {displayAnswer(entry.key, entry.built) ?? "none"}</p> : null}
          {status === "answered" && source && FROM[source] ? <p className="mt-1 text-caption text-[var(--color-text-3)]">{FROM[source]}</p> : null}
          {status === "missing" && section ? (
            <p className="mt-1 text-caption text-[var(--color-text-3)]">The resume has none yet: they&apos;re added in the Builder.</p>
          ) : status === "missing" && source ? (
            <p className="mt-1 text-caption text-[var(--color-text-3)]">{UNKNOWN[source]} Forms that ask this are left to you{mayEdit ? " until you add an answer" : ""}.</p>
          ) : null}
          {entry.also.length > 0 ? <p className="mt-1 text-caption text-[var(--color-text-3)]">Also asked as: {entry.also.join(" · ")}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {status === "edited" ? <Tag tone="blue">Yours</Tag> : null}
          {status === "missing" ? <Tag tone="amber">To answer</Tag> : null}
          {!isEditing && section ? (
            <Button size="sm" variant="ghost" onClick={() => onEditInBuilder(section)} title="Lists of jobs, schools, projects and awards are changed in the resume itself">
              {canEdit ? "Edit in Builder" : "Open in Builder"}<ArrowUpRight size={14} aria-hidden />
            </Button>
          ) : null}
          {mayEdit && !isEditing && status === "review" ? (
            <>
              <Button size="sm" variant="secondary" disabled={isSaving} onClick={() => save((onlyThis) => keepMineChange(entry, onlyThis))}>Keep mine</Button>
              <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => save((onlyThis) => resetChange(entry, onlyThis))}>Use the new one</Button>
            </>
          ) : null}
          {mayEdit && !isEditing && status === "missing" ? (
            <Button size="sm" variant="secondary" disabled={isSaving} onClick={() => setIsEditing(true)}><Plus size={14} aria-hidden />Add answer</Button>
          ) : null}
          {mayEdit && !isEditing && (status === "answered" || status === "edited" || status === "custom") ? (
            <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => setIsEditing(true)} aria-label={`Edit the answer to: ${entry.question}`}>
              <Pencil size={14} aria-hidden />Edit
            </Button>
          ) : null}
          {mayEdit && !isEditing && status === "edited" ? (
            <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => save((onlyThis) => resetChange(entry, onlyThis))}
              title={isOwnAnswer(source) ? "Remove this answer" : "Back to BenchQ's answer"}>
              <RotateCcw size={14} aria-hidden />{isOwnAnswer(source) ? "Remove" : "Reset"}
            </Button>
          ) : null}
          {mayEdit && !isEditing && status === "custom" ? (
            <Button size="sm" variant="ghost" disabled={isSaving} onClick={() => setIsConfirmingDelete(true)} aria-label={`Delete the question: ${entry.question}`}
              className="text-[var(--color-danger-fg)] hover:text-[var(--color-danger-fg)]">
              <Trash2 size={14} aria-hidden />Delete
            </Button>
          ) : null}
        </div>
      </div>
      {isEditing ? (
        <AnswerEditor question={entry.question} type={entry.type} initial={entry.answer} isSaving={isSaving} draftRow={draftRowOf(entry)}
          suggestions={entry.key ? ANSWER_SUGGESTIONS[entry.key] : undefined}
          isMultiline={entry.kind === "CUSTOM" || entry.key === "summary"} onSave={saveAnswer} onCancel={closeEditor} />
      ) : null}
      <ConfirmDialog open={isConfirmingDelete} title="Delete this question?" confirmLabel="Delete" tone="danger" cancelLabel="Keep it" isBusy={isSaving}
        onCancel={() => setIsConfirmingDelete(false)}
        onConfirm={() => { setIsConfirmingDelete(false); save((onlyThis) => removeChange(entry, onlyThis)); }}>
        <p>“{entry.question}” and its answer go, and the extension stops filling it.</p>
      </ConfirmDialog>
    </li>
  );
}
