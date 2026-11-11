import { describe, expect, it } from "vitest";
import { resumeFileName, withResumeFile } from "./documents";
import type { FieldKind, ReviewRow, TabField } from "./types";

const field = (id: string, label: string, kind: FieldKind = "file"): TabField => ({
  id, frameId: 0, pageUrl: "https://jobs.acme.test/1", kind, label, hints: "", autocomplete: "", required: false, current: "",
  options: [], maxLength: null, inAccountForm: false,
  clues: { name: "", id: "", placeholder: "", ariaLabel: "", nearbyText: "", sectionHeading: "", className: "", dataAttrs: "" },
});
const upload = (id: string, label: string): ReviewRow => ({ key: id, field: field(id, label), status: "blocked", reason: "File upload" });
const file = { name: "Priya Shah - Java Developer.pdf", mimeType: "application/pdf", data: "JVBERi0=" };

describe("the picked résumé's file (07 Q49–Q52)", () => {
  it("goes on the form's first résumé upload, never on a cover letter's", () => {
    const rows = withResumeFile([upload("c", "Cover letter"), upload("r", "Resume/CV"), upload("s", "Resume, another copy")], file);
    expect(rows.map(({ status }) => status)).toEqual(["blocked", "ready", "blocked"]);
    expect(rows[1]).toMatchObject({ proposed: file.name, reason: undefined, write: { type: "file", ...file } });
  });

  it("leaves the upload to the BDE when the résumé has no file, or the form no résumé upload", () => {
    const rows = [upload("r", "Resume")];
    expect(withResumeFile(rows, null)).toBe(rows);
    const letter = [upload("c", "Cover letter")];
    expect(withResumeFile(letter, file)).toBe(letter);
  });

  it("is named for the candidate and the résumé's title, as a file name can be written", () => {
    expect(resumeFileName("Priya Shah", "Java Developer")).toBe("Priya Shah - Java Developer");
    expect(resumeFileName("Priya Shah", null)).toBe("Priya Shah - Resume");
    expect(resumeFileName(" Priya  Shah ", "C/C++: Dev?")).toBe("Priya Shah - C C++ Dev");
  });
});
