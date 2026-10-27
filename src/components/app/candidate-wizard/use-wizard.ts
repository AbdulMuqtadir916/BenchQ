"use client";

import { useCallback, useEffect, useMemo, useReducer } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ResumeDraft } from "@/lib/schemas/resume-draft";
import { applyDraft, DRAFTABLE, EMPTY_VALUES, firstOpenStep, isDirty, STEPS, StepIdSchema, type DraftableField, type StepId, type WizardValues } from "./model";

/**
 * The new-candidate flow's state: the values in memory only (no drafts, 07 Q48), which fields came from the résumé,
 * and the step, which lives in the URL as `?step=` (CLAUDE.md: tabs live in the URL, parsed with Zod).
 */
interface State {
  values: WizardValues;
  drafted: ReadonlySet<DraftableField>;
}

type Action =
  | { type: "set"; field: keyof WizardValues; value: WizardValues[keyof WizardValues] }
  | { type: "draft"; draft: ResumeDraft }
  | { type: "reviewed"; fields: readonly DraftableField[] }
  | { type: "reset" };

const INITIAL: State = { values: EMPTY_VALUES, drafted: new Set() };
const isDraftable = (field: string): field is DraftableField => (DRAFTABLE as readonly string[]).includes(field);

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set": {
      const drafted = new Set(state.drafted);
      // Editing a drafted field makes it the person's own: the marker goes (Q49).
      if (isDraftable(action.field)) drafted.delete(action.field);
      return { values: { ...state.values, [action.field]: action.value }, drafted };
    }
    case "draft": {
      const { values, drafted } = applyDraft(state.values, action.draft);
      return { values, drafted: new Set([...state.drafted, ...drafted]) };
    }
    case "reviewed": {
      const drafted = new Set(state.drafted);
      for (const field of action.fields) drafted.delete(field);
      return { ...state, drafted };
    }
    case "reset":
      return INITIAL;
  }
}

export function useWizard() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const router = useRouter();
  const pathname = usePathname();
  const requested = StepIdSchema.catch("resume").parse(useSearchParams().get("step") ?? "resume");
  // A reload starts empty, so a step past an unfinished one opens that one instead.
  const step = firstOpenStep(requested, state.values);

  const goTo = useCallback((next: StepId) => {
    router.replace(next === "resume" ? pathname : `${pathname}?step=${next}`, { scroll: false });
  }, [router, pathname]);

  useEffect(() => {
    if (step !== requested) goTo(step);
  }, [step, requested, goTo]);

  const set = useCallback(<K extends keyof WizardValues>(field: K, value: WizardValues[K]) => dispatch({ type: "set", field, value }), []);
  const applyResume = useCallback((draft: ResumeDraft) => dispatch({ type: "draft", draft }), []);
  const markReviewed = useCallback((fields: readonly DraftableField[]) => dispatch({ type: "reviewed", fields }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  const index = STEPS.findIndex((item) => item.id === step);
  return useMemo(() => ({
    values: state.values,
    drafted: state.drafted,
    isDirty: isDirty(state.values),
    step,
    stepIndex: index,
    goTo,
    set,
    applyResume,
    markReviewed,
    reset,
  }), [state, step, index, goTo, set, applyResume, markReviewed, reset]);
}

export type Wizard = ReturnType<typeof useWizard>;
