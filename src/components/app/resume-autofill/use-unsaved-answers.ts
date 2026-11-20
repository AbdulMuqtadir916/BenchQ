"use client";

import { useEffect, useId, useMemo } from "react";
import { create } from "zustand";

/** The Autofill tab's answers being written and not saved yet, by editor, with the row each is on. Each lives in its
 * editor, not in the studio's document, so the studio asks here before it leaves the tab (another tab, Close, Save):
 * leaving drops them. A filter or a search keeps their rows in view, so neither closes an editor. */
interface UnsavedAnswers {
  editors: ReadonlyMap<string, string>;
  mark: (editor: string, isUnsaved: boolean, row?: string) => void;
}

export const useUnsavedAnswers = create<UnsavedAnswers>((set) => ({
  editors: new Map(),
  mark: (editor, isUnsaved, row = editor) => set((state) => {
    if (isUnsaved ? state.editors.get(editor) === row : !state.editors.has(editor)) return state;
    const editors = new Map(state.editors);
    if (isUnsaved) editors.set(editor, row);
    else editors.delete(editor);
    return { editors };
  }),
}));

/** Whether leaving the Autofill tab now would drop an answer someone is writing. */
export const hasUnsavedAnswers = () => useUnsavedAnswers.getState().editors.size > 0;

/** The rows holding an answer being written (`draftRowOf`, `ADD_ROW`). */
export function useDraftRows(): ReadonlySet<string> {
  const editors = useUnsavedAnswers((state) => state.editors);
  return useMemo(() => new Set(editors.values()), [editors]);
}

/** Tells the studio whether this editor, on `row`, holds an unsaved answer; a closed editor (saved, cancelled, gone)
 * holds none. */
export function useUnsavedAnswer(isUnsaved: boolean, row: string) {
  const editor = useId();
  useEffect(() => {
    useUnsavedAnswers.getState().mark(editor, isUnsaved, row);
  }, [editor, isUnsaved, row]);
  useEffect(() => () => useUnsavedAnswers.getState().mark(editor, false), [editor]);
}
