import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A NEXT_PUBLIC_ variable is built into the browser bundle, so its name must never say it holds a secret.
 * Scans src/, next.config.ts and .env.example for every NEXT_PUBLIC_ name.
 */
const ROOT = join(__dirname, "../../..");
const SECRET_WORDS = /KEY|SECRET|TOKEN|PASSWORD/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

describe("NEXT_PUBLIC_ variable names", () => {
  it("never name a key, secret, token or password", () => {
    const files = [...sourceFiles(join(ROOT, "src")), join(ROOT, "next.config.ts"), join(ROOT, ".env.example")];
    const names = new Set(files.flatMap((path) => readFileSync(path, "utf8").match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? []));
    expect(names.size).toBeGreaterThan(0);
    expect([...names].filter((name) => SECRET_WORDS.test(name.slice("NEXT_PUBLIC_".length)))).toEqual([]);
  });
});
