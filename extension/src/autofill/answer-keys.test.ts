import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KEY_TYPES, typeOfKey } from "./answer-keys";

/** The fixed questions' keys as the backend lists them: `QUESTIONS` in backend/candidates/autofill.py. */
function backendKeys(): string[] {
  const source = readFileSync(new URL("../../../backend/candidates/autofill.py", import.meta.url), "utf-8");
  const block = /^QUESTIONS: dict\[str, str\] = \{\n([\s\S]*?)\n\}/m.exec(source.replace(/\r\n/g, "\n"));
  if (!block) throw new Error("QUESTIONS not found in backend/candidates/autofill.py");
  return [...block[1]!.matchAll(/^\s+"([a-z0-9-]+)":/gm)].map(([, key]) => key!);
}

describe("the answer keys", () => {
  it("cover every fixed question the backend asks, so a new one can't be forgotten here", () => {
    const keys = backendKeys();
    expect(keys.length).toBeGreaterThan(30);
    expect(keys.filter((key) => typeOfKey(key) === undefined)).toEqual([]);
  });

  it("name no question the backend no longer asks, beside the ones worked out here", () => {
    const keys = new Set(backendKeys());
    expect(Object.keys(KEY_TYPES).filter((key) => !key.startsWith("benchq:") && !keys.has(key))).toEqual([]);
  });

  it("read a key missing from the table by its wording", () => {
    expect(typeOfKey("a-question-added-later")).toBeUndefined();
    expect(typeOfKey("professional-title")).toBeNull();
    expect(typeOfKey("address-city")).toBe("address-city");
  });
});
