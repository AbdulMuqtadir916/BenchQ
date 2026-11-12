"use client";

import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addChange, questionError } from "@/lib/derive/autofill";
import type { AutofillEntry } from "@/lib/schemas/resume-autofill";
import type { SaveAutofill } from "./autofill-row";
import { ADD_ROW } from "@/lib/derive/autofill-view";
import { useUnsavedAnswer } from "./use-unsaved-answers";

const OWN = "";

type AddQuestionProps = {
  entries: readonly AutofillEntry[];
  /** BenchQ's questions with no answer yet (self-identification first): picking one opens its own editor, in its row. */
  available: readonly AutofillEntry[];
  isSaving: boolean;
  onSave: SaveAutofill;
  onPickQuestion: (key: string) => void;
  onDone: () => void;
};

/** A question for this version: one of BenchQ's that has no answer yet, picked from the list (its row then takes the
 * answer, in the control its type takes), or one of the user's own with its answer, such as "Why do you want to work
 * here?" (07 Q14). A question already here, in any capitals or punctuation, gets the new answer (Q43). Opened from "Add
 * a question"; Esc or Cancel closes it, and a save closes it. */
export function AddQuestion({ entries, available, isSaving, onSave, onPickQuestion, onDone }: AddQuestionProps) {
  const id = useId();
  const [picked, setPicked] = useState(OWN);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  useUnsavedAnswer(picked === OWN && Boolean(question.trim() || answer.trim()), ADD_ROW);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (picked !== OWN) {
      onPickQuestion(picked);
      return;
    }
    const problem = questionError(question, entries) ?? (answer.trim() ? null : "Write the answer.");
    setError(problem);
    if (problem) return;
    if (await onSave((onlyThis) => addChange(question, answer, onlyThis))) onDone();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDone();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} onKeyDown={onKeyDown} aria-labelledby={`${id}-title`}
      className="space-y-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
      <p id={`${id}-title`} className="text-body-strong text-[var(--color-text)]">New question</p>
      {available.length > 0 ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-pick`} className="text-label text-[var(--color-text-2)]">Question</label>
          <select id={`${id}-pick`} value={picked} onChange={(event) => setPicked(event.target.value)} autoFocus
            className="bq-input w-full text-body sm:max-w-md">
            <option value={OWN}>Write my own question</option>
            <optgroup label="BenchQ's questions with no answer yet">
              {available.map((entry) => <option key={entry.key} value={entry.key ?? ""}>{entry.question}</option>)}
            </optgroup>
          </select>
        </div>
      ) : null}
      {picked === OWN ? (
        <>
          <div className="space-y-1">
            <label htmlFor={`${id}-question`} className="text-label text-[var(--color-text-2)]">Question, as forms ask it</label>
            <Input id={`${id}-question`} autoFocus={available.length === 0} placeholder="Why do you want to work here?" value={question} maxLength={300}
              readOnly={isSaving} onChange={(event) => setQuestion(event.target.value)} className="w-full" />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-answer`} className="text-label text-[var(--color-text-2)]">Answer</label>
            <textarea id={`${id}-answer`} rows={3} value={answer} maxLength={4000} readOnly={isSaving} onChange={(event) => setAnswer(event.target.value)}
              aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
              className="bq-input h-auto w-full py-2 text-body" placeholder="The answer the extension fills" />
          </div>
        </>
      ) : <p className="text-sm text-[var(--color-text-3)]">Its answer goes in its own row, in the control it takes.</p>}
      {error ? <p id={`${id}-error`} role="alert" className="text-sm text-[var(--color-danger-fg)]">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>{picked !== OWN ? "Answer it" : isSaving ? "Saving…" : "Add question"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        {picked === OWN ? <span className="text-caption text-[var(--color-text-3)]">Ctrl+Enter adds it</span> : null}
      </div>
    </form>
  );
}
