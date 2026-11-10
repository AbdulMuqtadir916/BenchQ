"use client";

import { useMemo } from "react";
import type { BulletSection, ResumeDocument, ResumeHeader, ResumeListKey, RichText } from "@/lib/schemas/resume-document";
import { addBullet, addEntry, moveEntry, patchEntry, removeBullet, removeEntry, updateText } from "@/lib/resume-doc/ops";
import { useStudio } from "./studio-store";

type TopField = "fullName" | "title" | "name";

/** Document edits bound to the studio store — one place both modes write through. */
export function useDocActions() {
  const update = useStudio((s) => s.update);
  return useMemo(
    () => ({
      setTop: (key: TopField, value: string) => update((d) => ({ ...d, [key]: value })),
      setHeader: (key: keyof ResumeHeader, value: string) => update((d) => ({ ...d, header: { ...d.header, [key]: value } })),
      patch: <K extends ResumeListKey>(key: K, id: string, p: Partial<ResumeDocument[K][number]>) => update((d) => patchEntry(d, key, id, p)),
      add: <K extends ResumeListKey>(key: K, entry: ResumeDocument[K][number]) => update((d) => addEntry(d, key, entry)),
      remove: (key: ResumeListKey, id: string) => update((d) => removeEntry(d, key, id)),
      move: (key: ResumeListKey, id: string, dir: -1 | 1) => update((d) => moveEntry(d, key, id, dir)),
      setTextHtml: (textId: string, html: string) => update((d) => updateText(d, textId, (t) => ({ ...t, html }))),
      addBullet: (section: BulletSection, entryId: string, bullet: RichText, afterId?: string) => update((d) => addBullet(d, section, entryId, bullet, afterId)),
      removeBullet: (section: BulletSection, entryId: string, bulletId: string) => update((d) => removeBullet(d, section, entryId, bulletId)),
    }),
    [update],
  );
}
