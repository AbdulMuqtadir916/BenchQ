"use client";

import { useUseAsBase } from "@/lib/hooks/use-resumes";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useStudio } from "./studio-store";

/**
 * After a save of v2 or later: "Use this as the base?" (resume-versioning.md §4.3). Yes copies it as v1 of a new
 * base, which becomes the one the workflow uses; No keeps it as history only.
 */
export function UseAsBaseDialog() {
  const ask = useStudio((s) => s.askUseAsBase);
  const setAsk = useStudio((s) => s.setAskUseAsBase);
  const notify = useStudio((s) => s.notify);
  const useAsBase = useUseAsBase();

  return (
    <ConfirmDialog
      open={!!ask}
      title="Use this as the base?"
      confirmLabel="Use as the base"
      cancelLabel="Not now"
      isBusy={useAsBase.isPending}
      onCancel={() => setAsk(null)}
      onConfirm={() => {
        if (!ask) return;
        useAsBase.mutate({ candidateId: ask.candidateId, versionId: ask.versionId }, {
          onSuccess: () => { setAsk(null); notify(`v${ask.number} is now the base in use. New tailoring starts from it.`); },
          onError: (error) => { setAsk(null); notify(error instanceof Error ? error.message : "That didn't go through. Try again.", "danger"); },
        });
      }}
    >
      <p>v{ask?.number} becomes a new base and the one the workflow uses: new tailoring starts from it. The current base stays as it is, and copies already tailored keep theirs.</p>
    </ConfirmDialog>
  );
}
