"use client";

import { useSyncExternalStore } from "react";
import { Input } from "@/components/ui/input";
import { slugProblem } from "@/lib/derive/platform";
import { hrefFor } from "@/lib/routes/registry";
import { Field, fieldAria } from "./admin-dialog";

const noSubscribe = () => () => {};

/**
 * The slug input with its live check (A7, 07 §2.4): pattern and length, reserved word, taken — each
 * its own message — and the URL it gives the firm's workspace.
 */
export function SlugField({ id, value, onChange, taken, showError }: { id: string; value: string; onChange: (slug: string) => void; taken: readonly string[]; showError: boolean }) {
  const host = useSyncExternalStore(noSubscribe, () => window.location.host, () => "");
  const problem = slugProblem(value, taken);
  const error = value || showError ? problem : null;
  return (
    <Field
      id={id}
      label="Slug"
      error={error}
      hint={
        <>
          Workspace URL: <span className="text-mono-sm text-[var(--color-text-2)]">{host}{hrefFor("dashboard", { firm: value || "your-slug" })}</span>
        </>
      }
    >
      <Input
        {...fieldAria(id, error, true)}
        value={value}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
      />
    </Field>
  );
}
