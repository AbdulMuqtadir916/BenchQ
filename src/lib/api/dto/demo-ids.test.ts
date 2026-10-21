import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import firm from "@/mocks/data/firm.json";
import invites from "@/mocks/data/invites.json";
import plans from "@/mocks/data/plans.json";
import platformUsers from "@/mocks/data/platform-users.json";
import { fromBackendId, toBackendId } from "./demo-ids";

/**
 * The fixture id → UUID map the demo seed uses (backend/scripts/seed_demo.py: UUIDv5 in one fixed namespace).
 * backend/tests/test_seed_and_admin_cli.py checks the same file against seed_demo.demo_id, so the two can't
 * drift. After adding a seeded fixture, run
 *   UPDATE_DEMO_IDS=1 pnpm exec vitest run src/lib/api/dto/demo-ids.test.ts
 */
const FILE = fileURLToPath(new URL("./demo-ids.json", import.meta.url));
const NAMESPACE = "6f1d4c2e-0b7a-5e3c-9a41-b3c0e5d2a7f8"; // NAMESPACE in seed_demo.py

function uuid5(name: string): string {
  const hash = createHash("sha1").update(Buffer.from(NAMESPACE.replace(/-/g, ""), "hex")).update(name, "utf8").digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function expectedMap(): Record<string, string> {
  const ids = [...plans, ...firm.firms, ...firm.users, ...platformUsers, ...invites].map((row) => row.id);
  return Object.fromEntries(ids.sort().map((fixtureId) => [fixtureId, uuid5(fixtureId)]));
}

describe("the demo seed's id map", () => {
  it("matches src/lib/api/dto/demo-ids.json", () => {
    const expected = expectedMap();
    if (process.env.UPDATE_DEMO_IDS === "1") writeFileSync(FILE, `${JSON.stringify(expected, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(expected);
  });

  it("is the seed's UUIDv5 (pinned like the backend's test)", () => {
    expect(uuid5("firm_hts")).toBe("d6d0fdd5-f446-5517-bef3-1df9447e2b91");
  });

  it("translates seeded ids both ways and passes any other id through", () => {
    expect(toBackendId("firm_hts")).toBe("d6d0fdd5-f446-5517-bef3-1df9447e2b91");
    expect(fromBackendId("d6d0fdd5-f446-5517-bef3-1df9447e2b91")).toBe("firm_hts");
    expect(toBackendId("0b9c6c1e-0000-4000-8000-000000000000")).toBe("0b9c6c1e-0000-4000-8000-000000000000");
    expect(fromBackendId("firm_new")).toBe("firm_new");
  });
});
