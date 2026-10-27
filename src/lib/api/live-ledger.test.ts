import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerEntrySchema } from "@/lib/schemas/analytics";
import demoIds from "./dto/demo-ids.json";

/**
 * The ledger on the live backend (docs/integration/01-ledger.md): the
 * path names the backend's firm id, paging goes through as query params, and the wire shape of
 * backend/auth/serialize.py `ledger_entry_json` maps to LedgerEntry with the demo ids translated back.
 */

const { ledgerApi } = await import("./analytics");
const { toBackendId } = await import("./dto/demo-ids");

const HTS = demoIds.firm_hts;
const entryDto = (over: Record<string, unknown> = {}) => ({
  id: "6f1c0000-0000-4000-8000-000000000001", firm_id: HTS, actor_user_id: demoIds.user_imran, actor_type: "USER",
  actor_name: "Imran", entity_type: "invite", entity_id: "6f1c0000-0000-4000-8000-000000000002", entity_label: "Bea",
  action: "INVITE_SENT", summary: "Invited Bea (bea@hts.test) as BDE", model_id: null, prompt_version: null,
  evidence_ids: [], claim_state: null, created_at: "2026-10-23T10:00:00+00:00", ...over,
});

let answer: { status: number; body: unknown };
const urls: string[] = [];

beforeEach(() => {
  urls.length = 0;
  answer = { status: 200, body: [] };
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the ledger on the live backend", () => {
  it("asks for the firm's ledger by its backend id, with the page", async () => {
    await ledgerApi.list("firm_hts", { limit: 100, offset: 0 });
    expect(urls).toEqual([`/api/firms/${HTS}/ledger?limit=100&offset=0`]);
  });

  it("filters by record and action, naming a seeded record by its backend id (07 Q52)", async () => {
    await ledgerApi.list("firm_hts", { entityType: "candidate", entityId: "cand_01", action: "ASSIGN", limit: 1 });
    expect(urls).toEqual([`/api/firms/${HTS}/ledger?limit=1&entity_type=candidate&entity_id=${toBackendId("cand_01")}&action=ASSIGN`]);
  });

  it("maps each entry to LedgerEntry, translating seeded ids back to fixture ids", async () => {
    answer.body = [entryDto()];
    const [entry] = await ledgerApi.list("firm_hts");
    expect(LedgerEntrySchema.parse(entry)).toEqual(entry);
    expect(entry).toMatchObject({ firmId: "firm_hts", actorUserId: "user_imran", actorType: "USER", action: "INVITE_SENT", createdAt: "2026-10-23T10:00:00.000Z" });
  });

  it("an empty ledger is an empty list, for the page's empty state", async () => {
    await expect(ledgerApi.list("firm_hts")).resolves.toEqual([]);
  });

  it("a backend error rejects, for the page's error state", async () => {
    answer = { status: 503, body: { detail: "Database unavailable" } };
    await expect(ledgerApi.list("firm_hts")).rejects.toThrow();
  });
});
