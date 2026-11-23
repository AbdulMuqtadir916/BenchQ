import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOAST_LAYER } from "./toast-layer";

/** A toast must be seen over whatever is open: no other overlay may reach its layer (the drawer bug, step 4b). */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const TOASTS = ["components/app/toast-viewport.tsx"];
const SELF = ["components/app/toast-layer.ts", "components/app/toast-layer.test.ts"];

const sourceFiles = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((file) => /\.(tsx?|css)$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => relative(SRC, join(SRC, file)).replaceAll("\\", "/"));

/** Every z-index a file sets: Tailwind `z-50` / `z-[60]` and CSS `z-index: 30`. */
function zIndexes(text: string): number[] {
  const found = [...text.matchAll(/(?<![\w-])-?z-(?:\[(-?\d+)\]|(\d+))(?![\w-])|z-index:\s*(-?\d+)/g)];
  return found.map((match) => Number(match[1] ?? match[2] ?? match[3]));
}

const toastLayer = Number(/^z-\[(\d+)\]$/.exec(TOAST_LAYER)?.[1]);

describe("toast layer", () => {
  it("is a number the scan can compare", () => {
    expect(Number.isInteger(toastLayer)).toBe(true);
  });

  it("sits above every other overlay in src/", () => {
    const tooHigh = sourceFiles
      .filter((file) => !SELF.includes(file) && !TOASTS.includes(file))
      .flatMap((file) => zIndexes(readFileSync(join(SRC, file), "utf8")).filter((z) => z >= toastLayer).map((z) => `${file}: ${z}`));
    expect(tooHigh).toEqual([]);
  });

  it.each(TOASTS)("%s takes its layer from TOAST_LAYER and sets no z-index of its own", (file) => {
    const text = readFileSync(join(SRC, file), "utf8");
    expect(text).toContain("TOAST_LAYER");
    expect(zIndexes(text)).toEqual([]);
  });

  it("the scan sees the overlays it guards against", () => {
    const drawer = readFileSync(join(SRC, "components/app/candidate/applications/application-drawer.tsx"), "utf8");
    expect(zIndexes(drawer)).toContain(50);
    expect(zIndexes("fixed z-[70] a")).toEqual([70]);
    expect(zIndexes(".x { z-index: 30; }")).toEqual([30]);
    expect(zIndexes("lazy-50 fuzz-1")).toEqual([]);
  });
});
