import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Phase T boundaries (docs/07 T4–T5), checked on the source so a new file can't slip past them:
 *  - hooks get the firm only from `useFirmId()`, never by reading the session's firm or principal
 *    (T6 moves `useFirmId()` to the URL; a hook that read the store directly would keep the old firm);
 *  - only the adapters in src/lib/api import a mock (src/mocks/auth.ts included), so no screen can
 *    read the mock backend's sign-in state or fixtures directly.
 */

const SRC_DIR = fileURLToPath(new URL("../..", import.meta.url));
const rel = (file: string) => relative(SRC_DIR, file).split(sep).join("/");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function matches(files: string[], pattern: RegExp): string[] {
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) => (pattern.test(line) ? [`${rel(file)}:${index + 1}  ${line.trim().slice(0, 100)}`] : [])),
  );
}

/** Reading the firm (or the principal, which carries firmId) from the session store. */
const SESSION_FIRM_READ = /useSession\s*(?:\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1|\.getState\(\s*\))\s*\.\s*(?:firm|principal)\b/;
/** Any static or dynamic import of a mock module. */
const MOCK_IMPORT = /(?:from\s+|import\(\s*)["'](?:@\/mocks|(?:\.\.?\/)+(?:[\w-]+\/)*mocks)(?:\/[\w./-]*)?["']/;

describe("firm and mock boundaries", () => {
  it("hooks get the firm only from useFirmId()", () => {
    expect(matches(sourceFiles(join(SRC_DIR, "lib", "hooks")), SESSION_FIRM_READ)).toEqual([]);
  });

  it("nothing outside src/lib/api (and src/mocks itself) imports a mock, src/mocks/auth.ts included", () => {
    const allowed = [join(SRC_DIR, "lib", "api") + sep, join(SRC_DIR, "mocks") + sep];
    const files = sourceFiles(SRC_DIR).filter((file) => !allowed.some((dir) => file.startsWith(dir)));
    expect(matches(files, MOCK_IMPORT)).toEqual([]);
  });

  it("detects each form it is meant to stop", () => {
    for (const bad of [
      "const firm = useSession((s) => s.firm);",
      "const id = useSession((state) => state.firm.id);",
      "const p = useSession((s) => s.principal);",
      "useSession.getState().firm.id",
      "useSession.getState().principal",
    ]) expect(SESSION_FIRM_READ.test(bad), bad).toBe(true);
    for (const ok of ["const firmId = useFirmId();", "const role = useSession((s) => s.user.role);", "const setSession = useSession((s) => s.setSession);"]) {
      expect(SESSION_FIRM_READ.test(ok), ok).toBe(false);
    }
    for (const bad of ['import { currentUser } from "@/mocks/auth";', 'import("@/mocks/candidates")', 'import { firms } from "../../mocks/team";', 'from "@/mocks"']) {
      expect(MOCK_IMPORT.test(bad), bad).toBe(true);
    }
    for (const ok of ['import { candidatesApi } from "@/lib/api/candidates";', 'import { cn } from "@/lib/cn";']) {
      expect(MOCK_IMPORT.test(ok), ok).toBe(false);
    }
  });
});
