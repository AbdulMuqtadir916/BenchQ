import { beforeEach, describe, expect, it } from "vitest";
import { hasUnsavedAnswers, useUnsavedAnswers } from "./use-unsaved-answers";

/** CodeRabbit on c47b6cf: switching from the Autofill tab, or closing the studio, dropped an answer being written
 * without asking. The studio asks while any editor holds one; this pins when that is. */
describe("unsaved Autofill answers", () => {
  beforeEach(() => useUnsavedAnswers.setState({ editors: new Set() }));

  it("count while any editor holds one, and stop once each is saved, cancelled or closed", () => {
    const { mark } = useUnsavedAnswers.getState();
    expect(hasUnsavedAnswers()).toBe(false);
    mark("salary", true);
    mark("new-question", true);
    expect(hasUnsavedAnswers()).toBe(true);
    mark("salary", false);
    expect(hasUnsavedAnswers()).toBe(true);
    mark("new-question", false);
    expect(hasUnsavedAnswers()).toBe(false);
  });

  it("don't count an editor twice, or one that never held an answer", () => {
    const { mark } = useUnsavedAnswers.getState();
    mark("salary", true);
    mark("salary", true);
    mark("location", false);
    expect(useUnsavedAnswers.getState().editors.size).toBe(1);
  });
});
