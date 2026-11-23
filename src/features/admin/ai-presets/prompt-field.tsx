"use client";

import { Pencil } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import type { AiPromptSpec } from "@/lib/schemas/ai-presets";
import { Field, fieldAria } from "../admin-dialog";

const MIN_ROWS = 6;
const MAX_ROWS = 14;

/** One prompt in its own box: locked until its pencil is clicked. The dialog keeps one box open at a time. */
export function PromptField({ spec, value, error, isEditing, onEdit, onChange }: { spec: AiPromptSpec; value: string; error: string | null; isEditing: boolean; onEdit: () => void; onChange: (value: string) => void }) {
  const id = `preset-prompt-${spec.name}`;
  const box = useRef<HTMLTextAreaElement>(null);
  const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, value.split("\n").length));

  function startEditing() {
    onEdit();
    box.current?.focus();
  }

  return (
    <Field id={id} label={spec.label} error={error} hint={spec.placeholders.length ? `Must keep ${spec.placeholders.join(", ")}` : undefined}>
      <div className="relative">
        <textarea
          {...fieldAria(id, error, spec.placeholders.length > 0)}
          ref={box}
          rows={rows}
          readOnly={!isEditing}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="bq-input h-auto w-full py-2 pr-10 font-mono text-caption read-only:bg-[var(--color-surface-2)]"
        />
        {!isEditing ? (
          <Button type="button" variant="ghost" size="sm" aria-label={`Edit ${spec.label}`} className="absolute right-1 top-1" onClick={startEditing}>
            <Pencil size={13} aria-hidden />
          </Button>
        ) : null}
      </div>
    </Field>
  );
}
