import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { firmKey, queryKeys } from "./keys";

const A = "firm_hts";
const B = "firm_stl";

/** Every firm-scoped key the factory can build, for one firm. */
function firmKeys(firmId: string): readonly (readonly unknown[])[] {
  const k = queryKeys;
  return [
    k.candidates.all(firmId), k.candidates.list(firmId), k.candidates.detail(firmId, "x"),
    k.jobs.all(firmId), k.jobs.list(firmId, { limit: 50 }), k.jobs.detail(firmId, "x"),
    k.applications.all(firmId), k.applications.list(firmId, { candidateId: "c" }), k.applications.detail(firmId, "x"),
    k.followups.list(firmId, { userId: "u" }),
    k.resumes.list(firmId), k.resumes.detail(firmId, "x"), k.resumes.byCandidate(firmId, "c"),
    k.records.byCandidate(firmId, "c"), k.documents.byCandidate(firmId, "c"), k.inbox.byCandidate(firmId, "c"),
    k.ledger.list(firmId, { limit: 100 }), k.team.list(firmId),
  ];
}

/** TanStack matches by prefix: a key "is under" a filter when it starts with it. */
const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) => prefix.every((part, i) => JSON.stringify(key[i]) === JSON.stringify(part));

describe("query key factory (docs/07 T5, principle 7)", () => {
  it("starts every firm-data key with the firm id", () => {
    for (const key of firmKeys(A)) expect(key[0], JSON.stringify(key)).toBe(A);
  });

  it("never lets two firms share a key, and clearing one firm's cache leaves the other's", () => {
    const keysA = firmKeys(A).map((key) => JSON.stringify(key));
    const keysB = firmKeys(B).map((key) => JSON.stringify(key));
    expect(keysA.filter((key) => keysB.includes(key))).toEqual([]);
    for (const key of firmKeys(A)) expect(startsWith(key, firmKey(A))).toBe(true);
    for (const key of firmKeys(B)) expect(startsWith(key, firmKey(A))).toBe(false);
  });

  it("puts a resource's lists and details under one prefix, so a mutation can invalidate them together", () => {
    const all = queryKeys.applications.all(A);
    expect(startsWith(queryKeys.applications.list(A, { candidateId: "c" }), all)).toBe(true);
    expect(startsWith(queryKeys.applications.detail(A, "app_001"), all)).toBe(true);
    expect(startsWith(queryKeys.candidates.list(A), all)).toBe(false);
    expect(startsWith(queryKeys.applications.list(A, { candidateId: "c" }), queryKeys.applications.lists(A))).toBe(true);
    expect(startsWith(queryKeys.applications.detail(A, "app_001"), queryKeys.applications.lists(A))).toBe(false);
  });

  it("keeps global data out of any firm: companies (Q13) and the session", () => {
    for (const key of [queryKeys.companies.all(), queryKeys.companies.detail("comp_01"), queryKeys.session.current(), queryKeys.session.devPrincipals()]) {
      expect(String(key[0]).startsWith("firm_")).toBe(false);
    }
  });

  it("is the only source of query keys in the hooks (no literal arrays)", () => {
    const dir = fileURLToPath(new URL("../hooks", import.meta.url));
    const literal = readdirSync(dir)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) => readFileSync(join(dir, file), "utf8").split("\n").map((line, i) => [file, i + 1, line] as const))
      .filter(([, , line]) => /queryKey:\s*\[/.test(line));
    expect(literal.map(([file, n, line]) => `${file}:${n} ${line.trim()}`)).toEqual([]);
  });
});
