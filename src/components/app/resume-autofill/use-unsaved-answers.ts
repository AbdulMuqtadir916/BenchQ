"use client";

import { useEffect, useId } from "react";
import { create } from "zustand";

/** The Autofill tab's answers being written and not saved yet, by editor. Each lives in its editor, not in the studio's
 * document, so the studio asks here before it leaves the tab (another tab, Close): leaving drops them. */
interface UnsavedAnswers {
  editors: ReadonlySet<string>;
  mark: (editor: string, isUnsaved: boolean) => void;
}

export const useUnsavedAnswers = create<UnsavedAnswers>((set) => ({
  editors: new Set(),
  mark: (editor, isUnsaved) => set((state) => {
    if (state.editors.has(editor) === isUnsaved) return state;
    const editors = new Set(state.editors);
    if (isUnsaved) editors.add(editor);
    else editors.delete(editor);
    return { editors };
  }),
}));

/** Whether leaving the Autofill tab now would drop an answer someone is writing. */
export const hasUnsavedAnswers = () => useUnsavedAnswers.getState().editors.size > 0;

/** Tells the studio whether this editor holds an unsaved answer; a closed editor (saved, cancelled, gone) holds none. */
export function useUnsavedAnswer(isUnsaved: boolean) {
  const editor = useId();
  useEffect(() => {
    useUnsavedAnswers.getState().mark(editor, isUnsaved);
  }, [editor, isUnsaved]);
  useEffect(() => () => useUnsavedAnswers.getState().mark(editor, false), [editor]);
}
