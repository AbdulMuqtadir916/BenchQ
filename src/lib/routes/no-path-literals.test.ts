import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./registry";

/**
 * docs/07 §1.2 and §5: the registry is the only place a path string exists. Links are built with
 * `hrefFor()` / `useHref()`; nothing else may hard-code an app path, so that moving every URL
 * (Phase T adds `/[firm]`) stays a change to src/lib/routes/.
 */

const SRC_DIR = fileURLToPath(new URL("../..", import.meta.url));
const ROUTES_DIR = join(SRC_DIR, "lib", "routes");

/**
 * An app path used as a link target:
 *  - `href="/…"`, `href={"/…"}`, `href: "/…"`, `backHref = "/…"` (any prop ending in href)
 *  - `.push("/…")` and `.replace("/…")` on any router (`router.push`, `r.push`)
 *  - `redirect("/…")`
 * Template literals count: `href={`/candidates/${id}`}`.
 */
const PATH_LITERAL = /(?:[A-Za-z]*[Hh]ref\s*[=:]\s*\{?\s*["'`]\/)|(?:\.(?:push|replace)\(\s*["'`]\/)|(?:redirect\(\s*["'`]\/)/;

function sourceFiles(dir = SRC_DIR): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return full === ROUTES_DIR ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * Any string or template literal that starts like an app path: `/` + the first segment of a route
 * (`/candidates`, `/resumes/…`, `/dev/…`, `/sign-in`). Catches what the link forms above miss: a path
 * in a ternary, returned from a helper, or kept in a variable. Since T6 such a path also lacks the firm.
 */
const ROUTE_SEGMENTS = [...new Set(ROUTES.map((route) => route.path.split("/").filter((segment) => segment && !segment.startsWith("["))[0]).filter(Boolean))];
const ROUTE_LITERAL = new RegExp(`["'\`]/(?:${ROUTE_SEGMENTS.join("|")})(?=[/?#"'\`$])`);

function findPathLiterals(files = sourceFiles(), pattern = PATH_LITERAL): string[] {
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return [];
        return pattern.test(line) ? [`${relative(SRC_DIR, file).split(sep).join("/")}:${index + 1}  ${code.slice(0, 100)}`] : [];
      }),
  );
}

describe("no path literals outside src/lib/routes", () => {
  it("builds every link with hrefFor() / useHref()", () => {
    expect(findPathLiterals()).toEqual([]);
  });

  it("has no app path in any string literal, wherever it is used", () => {
    expect(ROUTE_SEGMENTS).toEqual(expect.arrayContaining(["candidates", "resumes", "settings", "dev", "sign-in"]));
    expect(findPathLiterals(sourceFiles(), ROUTE_LITERAL)).toEqual([]);
  });

  it("catches the forms that slipped past the link rule before T6", () => {
    for (const bad of ['href={context ? `/resumes/new` : "/resumes/new"}', "return master ? `/resumes/${id}?review=1` : null;", 'const to = "/candidates";', "router.push(next ?? '/dashboard')"]) {
      expect(ROUTE_LITERAL.test(bad), bad).toBe(true);
    }
    for (const ok of ['href="https://example.com/candidates"', 'import x from "@/components/app/resumes/card"', 'aria-label="candidates/new"', '"/candidatesx"']) {
      expect(ROUTE_LITERAL.test(ok), ok).toBe(false);
    }
  });

  it("detects each literal form it is meant to stop", () => {
    const forms = [
      'a href="/candidates"',
      "<Link href={`/candidates/${id}`}>",
      'href: "/followups"',
      'backHref = "/dashboard"',
      'router.push("/jobs")',
      "r.push(`/jobs/${id}`)",
      'router.replace("/welcome")',
      'redirect("/dashboard")',
    ];
    for (const form of forms) expect(PATH_LITERAL.test(form), form).toBe(true);
    for (const ok of ['href={toHref("jobs")}', 'router.push(toHref("jobs"))', 'href="https://example.com"', 'href="#top"', 'href="mailto:a@b.c"']) {
      expect(PATH_LITERAL.test(ok), ok).toBe(false);
    }
  });
});
