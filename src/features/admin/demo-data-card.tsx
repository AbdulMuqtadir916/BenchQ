"use client";

import { useId, useRef, useState } from "react";
import { Database, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { useResetDemoData } from "@/lib/hooks/use-demo-data";

/**
 * /admin/system: the demo data's reset (docs/03 §3.3). The demo data persists in this browser for every
 * account; resetting wipes every change made here and restores the original fixtures. A native modal
 * <dialog> confirms it (focus is held inside, Esc cancels, Cancel has the initial focus).
 * It goes with the mocks (Phase D).
 */
export function DemoDataCard() {
  const reset = useResetDemoData();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [done, setDone] = useState(false);

  function open() {
    setDone(false);
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }

  function confirm() {
    reset.mutate(undefined, {
      onSuccess: () => {
        dialogRef.current?.close();
        setDone(true);
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database size={15} aria-hidden />
          Demo data
        </CardTitle>
      </CardHeader>
      <p className="text-sm text-[var(--color-text-2)]">
        This browser keeps the demo data and every change made to it, by every account signed in here. Resetting restores the original
        demo data for all of them.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={open}>
          <RotateCcw size={14} aria-hidden />
          Reset demo data…
        </Button>
        {done ? (
          <p role="status" className="text-sm text-[var(--color-success-fg)]">
            Demo data reset to the original fixtures.
          </p>
        ) : null}
      </div>

      <dialog ref={dialogRef} className="bq-dialog" aria-labelledby={titleId} aria-describedby={bodyId} onCancel={(event) => reset.isPending && event.preventDefault()}>
        <h2 id={titleId} className="text-h3 text-[var(--color-text)]">Reset demo data?</h2>
        <div id={bodyId} className="mt-2 space-y-2 text-sm text-[var(--color-text-2)]">
          <p>
            This wipes <strong>every change made in this browser</strong>, by every account: moved applications, uploaded documents, edited
            candidates, accepted invites. The original demo data comes back.
          </p>
          <p>It can&apos;t be undone. Other browsers and devices keep their own demo data.</p>
        </div>
        {reset.isError ? (
          <p role="alert" className="mt-3 text-sm text-[var(--color-danger-fg)]">
            Couldn&apos;t reset the demo data. Try again.
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={() => dialogRef.current?.close()} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={reset.isPending}>
            {reset.isPending ? "Resetting…" : "Reset demo data"}
          </Button>
        </div>
      </dialog>
    </Card>
  );
}
