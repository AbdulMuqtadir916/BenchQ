"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { draftOf, parseDraft } from "@/lib/derive/autofill";
import type { AutofillAnswer, AutofillAnswerType } from "@/lib/schemas/resume-autofill";
import { useUnsavedAnswer } from "./use-unsaved-answers";

type AnswerEditorProps = {
  /** The question, which names the field. */
  question: string;
  type: AutofillAnswerType | null;
  initial: AutofillAnswer | undefined;
  /** A long answer (a summary, a question of the user's own) gets a box; Ctrl/⌘+Enter saves it. */
  isMultiline: boolean;
  /** Wordings forms commonly offer (self-identification), listed under a one-line answer; any answer can be typed. */
  suggestions?: readonly string[];
  isSaving: boolean;
  onSave: (answer: AutofillAnswer) => void;
  onCancel: () => void;
  /** The row the answer is on (`draftRowOf`): a filter or a search keeps it in view while it's being written. */
  draftRow: string;
};

/** One answer being written, in the control its type takes. Enter saves a one-line answer, Esc cancels. */
export function AnswerEditor({ question, type, initial, isMultiline, suggestions, isSaving, onSave, onCancel, draftRow }: AnswerEditorProps) {
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(initial));
  const [error, setError] = useState<string | null>(null);
  const isBox = isMultiline || type === "texts";
  useUnsavedAnswer(draft !== draftOf(initial), draftRow);

  const submit = () => {
    const parsed = parseDraft(draft, type);
    if ("error" in parsed) setError(parsed.error);
    else onSave(parsed.answer);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement) && (!isBox || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };
  const field = {
    id: `${id}-answer`,
    "aria-label": `Answer to: ${question}`,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : type === "texts" ? `${id}-hint` : undefined,
    autoFocus: true,
    value: draft,
    // What's saving stays what was sent: an answer changed meanwhile would close with the editor.
    readOnly: isSaving,
  };

  return (
    <form className="mt-2 space-y-2" onKeyDown={onKeyDown} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {type === "boolean" ? (
        <select {...field} onChange={(event) => setDraft(event.target.value)} className="bq-input w-40 text-body">
          <option value="">Choose…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      ) : isBox ? (
        <textarea {...field} rows={type === "texts" ? 5 : 4} onChange={(event) => setDraft(event.target.value)} className="bq-input h-auto w-full py-2 text-body" />
      ) : (
        // `step="any"`: a rate of 85.5 or 7.5 years is an answer, which the browser's whole-number step refused on Save
        // (the PR 129 review, finding 4).
        <Input {...field} type={type === "number" ? "number" : type === "date" ? "date" : "text"} min={type === "number" ? 0 : undefined}
          step={type === "number" ? "any" : undefined}
          inputMode={type === "number" ? "decimal" : undefined} onChange={(event) => setDraft(event.target.value)} className="w-full sm:max-w-md"
          list={suggestions?.length ? `${id}-suggestions` : undefined} />
      )}
      {suggestions?.length ? (
        <>
          <datalist id={`${id}-suggestions`}>{suggestions.map((option) => <option key={option} value={option} />)}</datalist>
          <div className="flex flex-wrap gap-1.5" aria-label="Common answers">
            {suggestions.map((option) => (
              <button key={option} type="button" onClick={() => setDraft(option)} aria-pressed={draft === option}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-0.5 text-sm text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] aria-pressed:border-[var(--color-primary)] aria-pressed:text-[var(--color-text)]">
                {option}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {type === "texts" ? <p id={`${id}-hint`} className="text-sm text-[var(--color-text-3)]">One per line.</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="text-sm text-[var(--color-danger-fg)]">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>{isSaving ? "Saving…" : "Save"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        {isBox ? <span className="text-sm text-[var(--color-text-3)]">Ctrl+Enter saves</span> : null}
      </div>
    </form>
  );
}
