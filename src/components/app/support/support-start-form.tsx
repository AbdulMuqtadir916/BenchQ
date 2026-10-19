"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { useStartSupportView } from "@/lib/hooks/use-support-view";
import type { Firm } from "@/lib/schemas/session";
import { SUPPORT_VIEW_MINUTES } from "@/lib/schemas/tenancy";

const MIN_REASON = 10;

/**
 * Start a read-only support view (docs/04 §14.10): a required reason (10+ characters, live counter) and
 * the notice that the firm sees it. Used by the "View workspace" dialog and the firm-URL interstitial.
 */
export function SupportStartForm({ firm, secondary, autoFocus = false }: { firm: Pick<Firm, "id" | "slug" | "name">; secondary?: ReactNode; autoFocus?: boolean }) {
  const start = useStartSupportView(firm);
  const [reason, setReason] = useState("");
  const id = useId();
  const length = reason.trim().length;
  const isBusy = start.isPending || start.isSuccess;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (length >= MIN_REASON && !isBusy) start.mutate(reason.trim());
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-label text-[var(--color-text-2)]">Reason</label>
        <textarea
          id={id}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          autoFocus={autoFocus}
          aria-describedby={`${id}-hint ${id}-notice`}
          className="bq-input h-auto w-full py-2"
        />
        <p id={`${id}-hint`} className="tabular text-caption text-[var(--color-text-3)]">{length} / {MIN_REASON} characters minimum</p>
      </div>
      <p id={`${id}-notice`} className="text-sm text-[var(--color-text-2)]">
        The firm will see your name and this reason in its activity log. The view is read-only and ends after {SUPPORT_VIEW_MINUTES} minutes.
      </p>
      {start.isError ? (
        <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{start.error instanceof ApiError ? start.error.message : "Couldn't start the support view. Try again."}</p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {secondary}
        <Button type="submit" disabled={length < MIN_REASON || isBusy}>
          <Eye size={14} aria-hidden /> {isBusy ? "Opening…" : "Start support view"}
        </Button>
      </div>
    </form>
  );
}
