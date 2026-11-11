"use client";

import { X } from "lucide-react";
import type { RichText } from "@/lib/schemas/resume-document";
import { EditableText } from "../editable-text";
import { useDocActions } from "../use-doc-actions";

interface RichFieldProps {
  field: RichText;
  label: string;
  placeholder?: string;
  onRemove?: () => void;
  onEnter?: () => void;
  onBackspaceEmpty?: () => void;
}

/** A rich-text field in Builder mode (summary, bullet, project description). */
export function RichField({ field, label, placeholder, onRemove, onEnter, onBackspaceEmpty }: RichFieldProps) {
  const a = useDocActions();

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <EditableText
          rich
          className="bq-rich-field text-body"
          value={field.html}
          onChange={(v) => a.setTextHtml(field.id, v)}
          label={label}
          placeholder={placeholder}
          fieldId={field.id}
          onEnter={onEnter}
          onBackspaceEmpty={onBackspaceEmpty}
        />
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label.toLowerCase()}`}
          className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-3)] hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger-fg)]"
        >
          <X size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
