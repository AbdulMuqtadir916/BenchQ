"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { missingForSave } from "@/lib/resume-doc/save-check";
import { useSaveResume } from "@/lib/hooks/use-resumes";
import { useHref } from "@/lib/routes/use-href";
import { useStudio, type StudioMode } from "./studio-store";

const FIELD_WORDS = { fullName: "the full name", email: "the email" } as const;

/**
 * Save (resume-versioning.md §4.3): the edit becomes the résumé's next version and the studio moves to it. A save of
 * v2 or later of a base asks "Use this as the base?". The header's name and email are required, as the backend says.
 */
export function useStudioSave(versionId: string, mode: StudioMode) {
  const save = useSaveResume();
  const router = useRouter();
  const toHref = useHref();

  const onSave = useCallback(() => {
    const { doc, notify, toggleSection, setAskUseAsBase, setPendingNotice } = useStudio.getState();
    if (!doc) return;
    const missing = missingForSave(doc);
    if (missing.length) {
      toggleSection("header", true);
      notify(`Add ${missing.map((m) => FIELD_WORDS[m]).join(" and ")} in the header before saving.`, "danger");
      return;
    }
    save.mutate({ versionId, doc }, {
      onSuccess: ({ opened, notice }) => {
        const saved = opened.resume.versions.find((v) => v.id === opened.versionId);
        setPendingNotice(notice ? { text: notice, tone: "danger" } : { text: `Saved as v${saved?.versionNumber ?? ""}.`, tone: "info" });
        if (opened.resume.isMaster && saved && saved.versionNumber > 1) {
          setAskUseAsBase({ candidateId: opened.resume.candidateId, versionId: opened.versionId, number: saved.versionNumber });
        }
        router.replace(toHref("resumes.studio", { id: opened.versionId }, mode === "view" ? { mode: "view" } : undefined));
      },
      onError: (error) => notify(error instanceof Error ? error.message : "The save didn't go through. Try again.", "danger"),
    });
  }, [save, versionId, mode, router, toHref]);

  return { onSave, isSaving: save.isPending };
}
