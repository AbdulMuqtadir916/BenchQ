/// <reference types="node" />
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mplSources } from "./licenses";

const SOURCE = fileURLToPath(new URL("./src/", import.meta.url));
const MOZILLA = "engine/ats-autofill-engine/core/heuristics/mozilla";

describe("the MPL-2.0 source the package ships", () => {
  it("is every file whose header says MPL-2.0, the heuristics ported from Mozilla, and nothing else", () => {
    expect(mplSources(SOURCE).map(({ path }) => path)).toEqual([
      `${MOZILLA}/classifier.ts`, `${MOZILLA}/normalize.ts`,
      `${MOZILLA}/rules/address.ts`, `${MOZILLA}/rules/contact.ts`, `${MOZILLA}/rules/eeo.ts`, `${MOZILLA}/rules/names.ts`,
    ]);
  });

  it("ships each file whole, its licence header first", () => {
    for (const { path, source } of mplSources(SOURCE)) expect(source, path).toMatch(/^\/\/ SPDX-License-Identifier: MPL-2\.0\r?\n/);
  });
});
