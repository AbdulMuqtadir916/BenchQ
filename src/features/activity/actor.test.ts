import { describe, expect, it } from "vitest";
import { actorDisplay } from "./actor";

describe("actorDisplay", () => {
  it("shows a person by name and role, with no tag", () => {
    expect(actorDisplay({ actorType: "USER", actorName: "Priya Nair", actorRole: "MANAGER", onBehalfOfName: null }))
      .toEqual({ name: "Priya Nair", role: "Manager", hasTag: false });
  });

  it("shows an AI agent as the person it worked for, tagged", () => {
    expect(actorDisplay({ actorType: "AGENT", actorName: "AI agent (Zoya Khan)", actorRole: "BDE", onBehalfOfName: "Zoya Khan" }))
      .toEqual({ name: "Zoya Khan", role: "BDE", hasTag: true });
  });

  it("gives the system a tag and no role", () => {
    expect(actorDisplay({ actorType: "SYSTEM", actorName: "Gmail sync", actorRole: null, onBehalfOfName: null }))
      .toEqual({ name: "Gmail sync", role: null, hasTag: true });
  });

  it("shows a Super Admin by role", () => {
    expect(actorDisplay({ actorType: "PLATFORM_ADMIN", actorName: "Sana", actorRole: "PLATFORM_ADMIN", onBehalfOfName: null }))
      .toEqual({ name: "Sana", role: "Super Admin", hasTag: false });
  });

  it("counts the tries a failed sign-in row stands for", () => {
    const entry = { actorType: "USER", actorName: "Karthik Reddy", actorRole: "BDE", onBehalfOfName: null } as const;
    expect(actorDisplay({ ...entry, attemptCount: 3 }).name).toBe("Karthik Reddy (3)");
    expect(actorDisplay({ ...entry, attemptCount: 1 }).name).toBe("Karthik Reddy");
  });

  it("falls back to the actor name on an AI row with no person", () => {
    expect(actorDisplay({ actorType: "AGENT", actorName: "AI agent", actorRole: null, onBehalfOfName: null }))
      .toEqual({ name: "AI agent", role: null, hasTag: true });
  });
});
