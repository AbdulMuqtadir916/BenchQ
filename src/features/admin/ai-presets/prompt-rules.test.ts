import { describe, expect, it } from "vitest";
import { promptProblem } from "./prompt-rules";

const spec = { name: "parse", label: "Parse", placeholders: ["{resume}"], optional: false };

describe("promptProblem", () => {
  it("needs the text and every placeholder", () => {
    expect(promptProblem(spec, "  ")).toBe("This prompt can't be empty.");
    expect(promptProblem(spec, "Read this")).toBe("Needs {resume}.");
    expect(promptProblem(spec, "Read {resume}")).toBeNull();
  });

  it("lets an optional prompt stay empty", () => {
    expect(promptProblem({ ...spec, placeholders: [], optional: true }, "")).toBeNull();
  });
});
