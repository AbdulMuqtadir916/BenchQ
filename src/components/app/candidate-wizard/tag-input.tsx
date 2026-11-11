"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { CornerDownLeft, Plus, X } from "lucide-react";

/**
 * Chips with a text box (skills, target roles, locations, industries, deal breakers). Only Enter (or the Add button)
 * adds what was typed, so a comma is ordinary text: "Columbus, OH" is one chip. Clicking a chip puts it back in the box
 * to edit; Backspace in an empty box does the same for the last chip. Each chip has its own remove button. Leaving the
 * box adds what is still typed, so nothing typed is lost. Duplicates (ignoring case) are not added. Suggestions are
 * buttons that add themselves; they are never filled in for the person.
 */
export function TagInput({
  id,
  values,
  onChange,
  suggestions = [],
  placeholder,
  describedBy,
  label,
}: {
  id: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  suggestions?: readonly string[];
  placeholder?: string;
  describedBy?: string;
  /** The field's name, for the chips' "Edit …" and "Remove …" labels. */
  label: string;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const has = (list: readonly string[], value: string) => list.some((item) => item.toLowerCase() === value.toLowerCase());

  /** `list` plus what was typed, when it is new. */
  function withTyped(list: readonly string[], raw: string): string[] {
    const value = raw.trim();
    return value && !has(list, value) ? [...list, value] : [...list];
  }

  function add(raw: string) {
    setText("");
    const next = withTyped(values, raw);
    if (next.length !== values.length) onChange(next);
  }

  /** Takes a chip out of the list and into the box; what was being typed is kept as a chip first. */
  function edit(value: string) {
    onChange(withTyped(values.filter((item) => item !== value), text));
    setText(value);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      add(text);
    } else if (event.key === "Backspace" && text === "" && values.length > 0) {
      event.preventDefault();
      edit(values[values.length - 1]!);
    }
  }

  const offered = suggestions.filter((suggestion) => !has(values, suggestion)).slice(0, 6);
  const hintId = `${id}-how`;

  return (
    <div className="space-y-2">
      <div className="bq-input flex h-auto min-h-[var(--control-height)] flex-wrap items-center gap-1.5 py-1">
        {values.map((value) => (
          <span key={value} className="bq-tag" data-tone="blue">
            <button type="button" className="rounded-[var(--radius-sm)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]" aria-label={`Edit ${value} in ${label}`} onClick={() => edit(value)}>
              {value}
            </button>
            <button type="button" className="rounded-[var(--radius-sm)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]" aria-label={`Remove ${value} from ${label}`} onClick={() => onChange(values.filter((item) => item !== value))}>
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            // Moving to this field's own Add button isn't leaving it: the button adds.
            if (event.relatedTarget?.closest(`[data-tag-add="${id}"]`)) return;
            add(text);
          }}
          placeholder={values.length === 0 ? placeholder : undefined}
          aria-describedby={[describedBy, hintId].filter(Boolean).join(" ")}
          className="min-w-24 flex-1 bg-transparent text-body outline-none placeholder:text-[var(--color-text-3)]"
        />
        {text.trim() ? (
          <button type="button" data-tag-add={id} onClick={() => { add(text); inputRef.current?.focus(); }} aria-label={`Add ${text.trim()} to ${label}`} className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-caption text-[var(--color-text-2)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]">
            <CornerDownLeft size={12} aria-hidden />
            Add
          </button>
        ) : null}
      </div>
      <p id={hintId} className="sr-only">Press Enter to add. Click a chip to edit it. Backspace in an empty box edits the last one.</p>
      {offered.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label={`Suggested ${label}`} role="group">
          <span className="text-caption text-[var(--color-text-3)]">Suggested</span>
          {offered.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => add(suggestion)} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-0.5 text-caption text-[var(--color-text-2)] hover:border-[var(--color-text-3)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]">
              <Plus size={11} aria-hidden />
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
