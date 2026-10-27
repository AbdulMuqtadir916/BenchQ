"use client";

import { useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";

/**
 * Chips with a text box (skills, target roles, locations, industries, deal breakers). Enter or a comma adds what was
 * typed; Backspace in an empty box removes the last chip; each chip has its own remove button. Duplicates (ignoring
 * case) are not added. Suggestions are buttons that add themselves; they are never filled in for the person.
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
  /** The field's name, for the chips' "Remove …" labels. */
  label: string;
}) {
  const [text, setText] = useState("");
  const has = (value: string) => values.some((item) => item.toLowerCase() === value.toLowerCase());

  function add(raw: string) {
    const value = raw.replace(/,+$/, "").trim();
    setText("");
    if (value && !has(value)) onChange([...values, value]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(text);
    } else if (event.key === "Backspace" && text === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  const offered = suggestions.filter((suggestion) => !has(suggestion)).slice(0, 6);
  const hintId = `${id}-how`;

  return (
    <div className="space-y-2">
      <div className="bq-input flex h-auto min-h-[var(--control-height)] flex-wrap items-center gap-1.5 py-1">
        {values.map((value) => (
          <span key={value} className="bq-tag" data-tone="blue">
            {value}
            <button type="button" className="rounded-[var(--radius-sm)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]" aria-label={`Remove ${value} from ${label}`} onClick={() => onChange(values.filter((item) => item !== value))}>
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          onChange={(event) => (event.target.value.endsWith(",") ? add(event.target.value) : setText(event.target.value))}
          onKeyDown={onKeyDown}
          onBlur={() => add(text)}
          placeholder={values.length === 0 ? placeholder : undefined}
          aria-describedby={[describedBy, hintId].filter(Boolean).join(" ")}
          className="min-w-24 flex-1 bg-transparent text-body outline-none placeholder:text-[var(--color-text-3)]"
        />
      </div>
      <p id={hintId} className="sr-only">Press Enter or comma to add. Backspace removes the last one.</p>
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
