import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerEditor } from "./answer-editor";

const editor = (type: "number" | "text") => renderToStaticMarkup(
  <AnswerEditor question="Expected rate" type={type} initial={undefined} isMultiline={false} isSaving={false}
    onSave={() => {}} onCancel={() => {}} draftRow="rate" />,
);

/** The PR 129 review, finding 4: Save refused a rate of 85.5 or 7.5 years, which the browser's whole-number step
 * rejects, though the contract and the parser take them (Enter saved through its own handler). */
describe("a number answer's field", () => {
  it("takes any fraction, and a text answer has no step", () => {
    expect(editor("number")).toContain('step="any"');
    expect(editor("text")).not.toContain("step=");
  });
});
