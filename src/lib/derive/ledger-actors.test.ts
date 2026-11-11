import { describe, expect, it } from "vitest";
import { LedgerEntrySchema, type LedgerEntry } from "@/lib/schemas/analytics";
import { ACTOR_FILTERS, ACTOR_LABEL, actorFilterLabel, countByActor, filterByActor } from "./ledger-actors";

/**
 * BUG-012: the Ledger's actor filter was a hand-written list of three (Users, AI agents, System), so the fourth actor type,
 * PLATFORM_ADMIN, had no option: a support view's rows (the audit of a Super Admin entering the firm) showed only under "All
 * actors". The options now come from the schema's own list of actor types, so a new type cannot be forgotten, and each option says
 * how many rows it would show, so an option that is always empty (no AI agent has written an entry yet) is visible as such.
 */
const entry = (id: string, actorType: LedgerEntry["actorType"]): LedgerEntry => ({
  id, firmId: "firm_hts", actorUserId: null, actorType, actorName: "x", entityType: "firm", entityId: "firm_hts", entityLabel: "HTS",
  action: "LOGIN", summary: "", note: null, modelId: null, promptVersion: null, createdAt: "2026-11-01T10:00:00.000Z",
});
const entries = [entry("a", "USER"), entry("b", "USER"), entry("c", "USER"), entry("d", "PLATFORM_ADMIN"), entry("e", "PLATFORM_ADMIN")];

describe("the actor filter's options", () => {
  it("has an option for every actor type the schema knows, after All, so none can be forgotten", () => {
    const schemaTypes = LedgerEntrySchema.shape.actorType.options;
    expect(ACTOR_FILTERS[0]).toBe("ALL");
    expect([...ACTOR_FILTERS.slice(1)].sort()).toEqual([...schemaTypes].sort());
    for (const type of schemaTypes) expect(ACTOR_LABEL[type], type).toBeTruthy();
  });

  it("includes Platform admins (the support view audit rows), in plain words", () => {
    expect(ACTOR_FILTERS).toContain("PLATFORM_ADMIN");
    expect(ACTOR_LABEL.PLATFORM_ADMIN).toBe("Platform admins");
    expect(ACTOR_LABEL.USER).toBe("Users");
    expect(ACTOR_LABEL.AGENT).toBe("AI agents");
    expect(ACTOR_LABEL.SYSTEM).toBe("System");
  });
});

describe("filterByActor", () => {
  it("All keeps everything; a type keeps only that type", () => {
    expect(filterByActor(entries, "ALL")).toHaveLength(5);
    expect(filterByActor(entries, "PLATFORM_ADMIN").map((e) => e.id)).toEqual(["d", "e"]);
    expect(filterByActor(entries, "USER").map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(filterByActor(entries, "AGENT")).toEqual([]);
  });
});

describe("countByActor and the option labels", () => {
  it("counts every actor type, zero for those with no rows", () => {
    expect(countByActor(entries)).toEqual({ USER: 3, PLATFORM_ADMIN: 2, AGENT: 0, SYSTEM: 0 });
  });

  it("labels each option with its row count, All with the total", () => {
    const counts = countByActor(entries);
    expect(actorFilterLabel("ALL", counts)).toBe("All actors (5)");
    expect(actorFilterLabel("PLATFORM_ADMIN", counts)).toBe("Platform admins (2)");
    expect(actorFilterLabel("AGENT", counts)).toBe("AI agents (0)");
  });
});
