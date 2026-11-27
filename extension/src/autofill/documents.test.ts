import { describe, expect, it } from "vitest";
import { accepts, DOCX_MIME, fileKey, fitsUpload, formatFor, PDF_MIME, readOwnFile, resumeFileName, withCoverLetterFile, withResumeFile } from "./documents";
import { accepts as pageAccepts } from "../page/accepts";
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

describe("the kind of file an upload takes (Q3)", () => {
  it("reads an accept list by type, extension or wildcard; an empty one takes anything", () => {
    expect(accepts("", PDF_MIME)).toBe(true);
    expect(accepts(".pdf, .docx", PDF_MIME)).toBe(true);
    expect(accepts(".doc,.docx", PDF_MIME)).toBe(false);
    expect(accepts("application/*", DOCX_MIME)).toBe(true);
    expect(accepts(DOCX_MIME, DOCX_MIME)).toBe(true);
    expect(accepts(".docx", "application/octet-stream", "cv.DOCX")).toBe(true);
    expect(accepts(".docx", "application/octet-stream", "cv")).toBe(false);
  });

  it("is the same rule the page uses right before writing a file (page.js keeps its own copy)", () => {
    const lists = ["", ".pdf", ".docx", ".doc,.docx", "application/pdf", "application/*", "*/*", "image/*", " .PDF , .Docx "];
    const files: [string, string][] = [[PDF_MIME, "a.pdf"], [DOCX_MIME, "a.docx"], ["application/msword", "a.doc"], ["application/octet-stream", "a.docx"], ["text/plain", "a.txt"]];
    for (const list of lists) for (const [type, name] of files) expect(pageAccepts(list, type, name)).toBe(accepts(list, type, name));
  });

  it("tells files apart by more than the name they go on the form by (#148)", () => {
    expect(fileKey({ name: "cv.pdf", id: "own:cv.pdf:3:1" })).toBe("own:cv.pdf:3:1");
    expect(fileKey({ name: "cv.pdf", data: "abcd" })).toBe("cv.pdf:4");
  });

  it("asks for the other kind only when the résumé upload won't take the file", () => {
    expect(formatFor([{ ...field("r", "Resume/CV"), accept: ".doc,.docx" }], PDF_MIME)).toBe("docx");
    expect(formatFor([{ ...field("r", "Resume"), accept: ".pdf" }], DOCX_MIME)).toBe("pdf");
    expect(formatFor([{ ...field("r", "Resume"), accept: ".pdf,.docx" }], PDF_MIME)).toBeNull();
    expect(formatFor([{ ...field("c", "Cover letter"), accept: ".docx" }], PDF_MIME)).toBeNull();
    expect(formatFor([{ ...field("r", "Resume"), accept: "image/*" }], PDF_MIME)).toBeNull();
  });

  it("keeps a file the résumé upload won't take off the form; a form without one takes any", () => {
    expect(fitsUpload([{ ...field("r", "Resume/CV"), accept: ".docx" }], PDF_MIME)).toBe(false);
    expect(fitsUpload([{ ...field("r", "Resume/CV"), accept: "image/*" }], DOCX_MIME)).toBe(false);
    expect(fitsUpload([{ ...field("r", "Resume/CV"), accept: ".pdf,.docx" }], PDF_MIME)).toBe(true);
    expect(fitsUpload([field("c", "Cover letter")], PDF_MIME)).toBe(true);
  });
});

describe("a file from the BDE's computer (Q5)", () => {
  it("is read into memory with its type, as the BDE's own", async () => {
    expect(await readOwnFile(new File(["%PDF-1.4"], "mine.PDF", { lastModified: 1 })))
      .toEqual({ name: "mine.PDF", mimeType: PDF_MIME, data: "JVBERi0xLjQ=", source: "picked", id: expect.stringMatching(/^own:[0-9a-f-]{36}$/) });
    // Two picks are two files, even of one file: each pick has its own identity (#148).
    const same = new File(["%PDF-1.4"], "mine.pdf", { lastModified: 1 });
    const [first, second] = await Promise.all([readOwnFile(same), readOwnFile(same)]);
    expect(typeof first === "object" && typeof second === "object" && first.id !== second.id).toBe(true);
    expect(await readOwnFile(new File(["x"], "cv.docx"))).toMatchObject({ mimeType: DOCX_MIME, source: "picked" });
  });

  it("is refused when it isn't a PDF or Word file, or is over 10 MB", async () => {
    expect(await readOwnFile(new File(["x"], "photo.png"))).toBe("Pick a PDF or Word file.");
    const big = new File(["x"], "big.pdf");
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
    expect(await readOwnFile(big)).toBe("That file is over 10 MB. Pick a smaller one.");
  });
});

describe("withCoverLetterFile, the picked cover letter on the form's cover-letter upload", () => {
  const upload = (label: string, accept = "") => ({ key: label, status: "manual", field: { label, kind: "file", hints: "", required: false, current: "", accept } }) as unknown as ReviewRow;
  const letter = { name: "Cover Letter.pdf", mimeType: "application/pdf", data: "JVBERi0=", source: "generated" as const, id: "cover:cl-2" };

  it("goes on the cover-letter upload, never the résumé's", () => {
    const rows = withCoverLetterFile([upload("Resume/CV"), upload("Cover Letter")], letter);
    expect(rows.map(({ status, write }) => [status, write?.type ?? null])).toEqual([["manual", null], ["ready", "file"]]);
    expect(rows[1]!.proposed).toBe("Cover Letter.pdf");
  });

  it("leaves an upload that won't take a PDF, a form without one, or no pick, as they are", () => {
    const wordOnly = [upload("Cover Letter", ".docx")];
    expect(withCoverLetterFile(wordOnly, letter)).toBe(wordOnly);
    const none = [upload("Resume/CV")];
    expect(withCoverLetterFile(none, letter)).toBe(none);
    const rows = [upload("Cover Letter")];
    expect(withCoverLetterFile(rows, null)).toBe(rows);
  });
});
