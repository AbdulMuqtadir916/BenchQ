import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * No screen shows an error's raw text: every error a user reads goes through describeError (src/lib/api/error-text.ts,
 * docs/02 §12), which gives the system errors (busy, throttled, offline, out of date, ours) the same words everywhere.
 * The scan reads every non-test .ts/.tsx under src/ for code that reads an error's own text or body.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));

const HINT = "show errors through describeError (src/lib/api/error-text.ts), see docs/02 §12";

/** Where an error's raw text is read on purpose: the error's construction and parsing, describeError, and the
 * components that render its ErrorText. */
const ALLOWED_PLACES = [
  "lib/api/http.ts",
  "lib/api/client.ts",
  "lib/api/dto/",
  "lib/api/error-text.ts",
  "components/app/error-state.tsx",
  "components/app/error-note.tsx",
  "components/app/error-reference.tsx",
];

/** What counts as reading an error's raw text. The receiver names are the ones the code uses for a caught or query
 * error (`error`, `err`, `e`, `query.error`); an ErrorText from describeError is named otherwise (`text`, `failure`,
 * `why`), and its `.message` is the sanctioned output. */
const ERROR_NAMES = ["error", "err", "e", "ex", "exc", "exception", "cause"];
const ERROR = `(?:${ERROR_NAMES.join("|")})`;
/** A parsed error body, whose `detail` is the backend's text. */
const BODY = `(?:${[...ERROR_NAMES, "body", "problem", "payload", "json"].join("|")})`;
const PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\b${ERROR}\??\.message\b`, "g"),
  new RegExp(String.raw`\b${BODY}\??\.details?\b`, "g"),
  /\bfieldErrors\b/g,
  new RegExp(String.raw`\{[^{}]*\b(?:message|details?|fieldErrors)\b[^{}]*\}\s*=\s*(?:[\w.]+\.)?${ERROR}\b`, "g"),
  new RegExp(String.raw`\bString\(\s*${ERROR}\s*\)`, "g"),
];

/**
 * Reads that are not display, each by file and the exact expression. A new read in one of these files still fails
 * unless it is the same expression.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; expression: string; reason: string }> = [
  {
    file: "app/sign-in/page.tsx",
    expression: "error?.message",
    reason: "`error` here is the ErrorText from signInError (which calls describeError); compared to INVALID_SIGN_IN for aria-invalid, not shown",
  },
  {
    file: "components/app/candidate/activity-tab.tsx",
    expression: "e.detail",
    reason: "`e` is an activity entry; its `detail` is the entry's line, not an error",
  },
  {
    file: "components/app/candidate/resumes/use-card-actions.tsx",
    expression: "e.message",
    reason: "inside describeError's screenText (never consulted for a system error): tested against a regex to pick the screen's own words, not shown",
  },
  {
    file: "components/app/tailoring/messages.ts",
    expression: "error.message",
    reason: "regex test for the backend's 'no active base' 409, to add the Résumés link; the shown text comes from describeError",
  },
  {
    file: "lib/api/resumes.ts",
    expression: "error.message",
    reason: "the adapter rethrows a 409 as DuplicateUploadError carrying the same text; mapping, not display",
  },
  {
    file: "lib/api/resumes.ts",
    expression: "error.details",
    reason: "the adapter reads the 409's baseResumeId and hidden flag from the body; mapping, not display",
  },
  {
    file: "lib/server/principal.ts",
    expression: "String(error)",
    reason: "wraps a thrown non-Error into an Error for the server gate; ErrorState shows it through describeError",
  },
];

/** Every raw error read in a source text, as the matched expressions. */
function rawErrorReads(text: string): string[] {
  return PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));
}

const sourceFiles = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => relative(SRC, join(SRC, file)).replaceAll("\\", "/"));

const isAllowedPlace = (file: string) => ALLOWED_PLACES.some((place) => (place.endsWith("/") ? file.startsWith(place) : file === place));
const isAllowlisted = (file: string, expression: string) => ALLOWLIST.some((entry) => entry.file === file && entry.expression === expression);

const readsByFile = new Map(sourceFiles.filter((file) => !isAllowedPlace(file)).map((file) => [file, rawErrorReads(readFileSync(join(SRC, file), "utf8"))]));

describe("error display", () => {
  it("no screen shows an error's raw text outside describeError", () => {
    const bypasses = [...readsByFile].flatMap(([file, reads]) => reads.filter((read) => !isAllowlisted(file, read)).map((read) => `${file}: ${read}`));
    expect(bypasses, HINT).toEqual([]);
  });

  it("every allowlist entry still matches a read (no stale entries)", () => {
    const stale = ALLOWLIST.filter((entry) => !(readsByFile.get(entry.file) ?? []).includes(entry.expression)).map((entry) => `${entry.file}: ${entry.expression}`);
    expect(stale).toEqual([]);
  });

  it("every allowed place exists", () => {
    const missing = ALLOWED_PLACES.filter((place) => !sourceFiles.some((file) => (place.endsWith("/") ? file.startsWith(place) : file === place)));
    expect(missing).toEqual([]);
  });

  it("catches a planted violation", () => {
    const planted = [
      "<p>{error.message}</p>",
      "toast(err.message)",
      "onError: (e) => setText(e.message)",
      "{query.error?.message}",
      "const why = error.details?.reason",
      "{body.detail}",
      "error.fieldErrors.map((f) => f.msg)",
      "const { message } = mutation.error",
      "setText(String(err))",
    ].join("\n");
    expect(rawErrorReads(planted)).toEqual([
      "error.message",
      "err.message",
      "e.message",
      "error?.message",
      "error.details",
      "body.detail",
      "fieldErrors",
      "{ message } = mutation.error",
      "String(err)",
    ]);
  });

  it("leaves ErrorText and domain fields alone", () => {
    const fine = [
      "const text = describeError(error); notify(text.message, 'danger', text.reference);",
      "{failure.message}",
      "{why.message}",
      "{suggestion.message.subject}",
      "{item.detail}",
      "toHref('candidates.detail', { id })",
      "queryKeys.jobs.detail(firmId, id)",
      "{toast.message}",
    ].join("\n");
    expect(rawErrorReads(fine)).toEqual([]);
  });
});
