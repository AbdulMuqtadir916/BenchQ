"use client";

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { DuplicateUploadError, useShowBase, useUploadResume } from "@/lib/hooks/use-resumes";
import { useShowToast } from "@/lib/stores/toast-store";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";

/**
 * The BDE's later résumé (resume-versioning.md §4.6): the file is read and becomes a new base, the one in use. The
 * same file again is refused; a hidden one is offered back; a deleted one comes back. Shown only on the candidate's
 * Résumés tab, so its words are the tab's: "résumé" and "main résumé", never "base".
 */
export function UploadResume({ candidateId, label = "Upload résumé" }: { candidateId: string; label?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useUploadResume();
  const showBase = useShowBase();
  const toast = useShowToast();
  const [hidden, setHidden] = useState<{ message: string; baseId: string } | null>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    upload.mutate({ candidateId, file }, {
      onSuccess: ({ restored, fileName }) => toast(restored ? `${fileName} was deleted before. It's back, and it's now the main résumé.` : `${fileName} was added, and it's now the main résumé.`),
      onError: (error) => {
        if (error instanceof DuplicateUploadError && error.isHidden) setHidden({ message: "You uploaded this file before, and it's on the hidden list. Show it again?", baseId: error.baseId });
        else if (error instanceof DuplicateUploadError) toast("This file is already one of the candidate's résumés.");
        else toast(error instanceof Error ? error.message : "The upload didn't go through. Try again.");
      },
    });
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".pdf,.docx" className="sr-only" aria-label="Résumé file" tabIndex={-1}
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
        {upload.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />}
        {upload.isPending ? "Reading the résumé…" : label}
      </Button>
      <ConfirmDialog open={!!hidden} title="Show this résumé again?" confirmLabel="Show again" isBusy={showBase.isPending}
        onCancel={() => setHidden(null)}
        onConfirm={() => hidden && showBase.mutate({ candidateId, baseId: hidden.baseId }, {
          onSuccess: () => { setHidden(null); toast("It's back on the list. Make it main if you want to send it by default."); },
          onError: (e) => { setHidden(null); toast(e instanceof Error ? e.message : "That didn't go through. Try again."); },
        })}>
        <p>{hidden?.message}</p>
      </ConfirmDialog>
    </>
  );
}
