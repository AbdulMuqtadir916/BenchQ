import { describe, expect, it } from "vitest";
import type { LedgerPerson } from "@/lib/schemas/analytics";
import { actorOptions, backStep, buildRail, resolveSelection, viewTitle, type Rail, type Viewer } from "./rail";
import { parseActivityParams, serializeActivityParams } from "./use-activity-params";
import { presets, rangeLabel } from "./date-range-filter";

const person = (userId: string, role: LedgerPerson["role"], managerId: string | null, actions: number, isFormer = false): LedgerPerson => ({
  userId, name: `${userId[0].toUpperCase()}${userId.slice(1)} Rao`, role, managerId, actions, isFormer,
});

const people = [
  person("owner", "OWNER", null, 5),
  person("viewer", "VIEWER", null, 1),
  person("mira", "MANAGER", null, 2),
  person("zed", "MANAGER", null, 1),
  person("bea", "BDE", "mira", 3),
  person("ben", "BDE", "mira", 1),
  person("cara", "BDE", "zed", 9),
  person("nia", "BDE", null, 1),
  person("old", "BDE", "mira", 2, true),
];

const owner: Viewer = { userId: "owner", scope: "firm" };
const mira: Viewer = { userId: "mira", scope: "team" };
const bea: Viewer = { userId: "bea", scope: "own" };

const firmRail = (rail: Rail) => { if (rail.level !== "firm") throw new Error(rail.level); return rail; };
const teamRail = (rail: Rail) => { if (rail.level !== "team") throw new Error(rail.level); return rail; };

describe("the people list", () => {
  it("starts an owner at the firm: managers busiest first, with their team's actions", () => {
    const rail = firmRail(buildRail(people, owner, {}, 30));
    expect(rail.managers.map((row) => [row.person.userId, row.bdes, row.actions])).toEqual([["zed", 1, 10], ["mira", 2, 6]]);
    expect(rail.owner?.userId).toBe("owner");
    expect(rail.you).toBeNull();
    expect(rail.unassigned.map((row) => row.userId)).toEqual(["nia"]);
    expect(rail.former.map((row) => row.userId)).toEqual(["old"]);
    expect(rail.total).toBe(30);
  });

  it("shows a Viewer the owner at the top, and themself under You", () => {
    const rail = firmRail(buildRail(people, { userId: "viewer", scope: "firm" }, {}, 30));
    expect(rail.owner?.userId).toBe("owner");
    expect(rail.you?.userId).toBe("viewer");
  });

  it("opening a manager hides the other managers", () => {
    const rail = teamRail(buildRail(people, owner, { team: "mira" }, 30));
    expect(rail.manager.userId).toBe("mira");
    expect(rail.bdes.map((row) => row.userId)).toEqual(["bea", "ben"]);
    expect(rail.actions).toBe(8);
  });

  it("keeps a BDE's team listed when one of them is picked", () => {
    expect(teamRail(buildRail(people, owner, { person: "ben" }, 30)).bdes.map((row) => row.userId)).toEqual(["bea", "ben"]);
  });

  it("stays at the firm for the owner's own actions and an unassigned BDE", () => {
    expect(buildRail(people, owner, { person: "owner" }, 30).level).toBe("firm");
    expect(buildRail(people, owner, { person: "nia" }, 30).level).toBe("firm");
  });

  it("starts a manager at their own team, and a BDE at one row", () => {
    expect(teamRail(buildRail(people, mira, {}, 30)).isOwnTeam).toBe(true);
    expect(buildRail(people, bea, {}, 30)).toEqual({ level: "own", me: people[4] });
  });
});

describe("a URL outside the reader's view", () => {
  it("falls back to their own root", () => {
    expect(resolveSelection(people.slice(0, 4), mira, { person: "cara" })).toEqual({});
    expect(resolveSelection(people, mira, { team: "zed" })).toEqual({});
    expect(resolveSelection(people, bea, { person: "ben" })).toEqual({});
    expect(resolveSelection(people, owner, { team: "bea" })).toEqual({});
  });

  it("keeps what they may see", () => {
    expect(resolveSelection(people, owner, { team: "zed" })).toEqual({ team: "zed" });
    expect(resolveSelection(people, mira, { person: "bea" })).toEqual({ person: "bea" });
    expect(resolveSelection(people, bea, { person: "bea" })).toEqual({ person: "bea" });
  });
});

describe("going back", () => {
  const step = (viewer: Viewer, selection: { team?: string; person?: string }) => backStep(buildRail(people, viewer, selection, 30), viewer, selection);

  it("climbs one level, never above the root", () => {
    expect(step(owner, { person: "bea" })).toEqual({ label: "Mira Rao's team", to: { team: "mira" } });
    expect(step(owner, { team: "mira" })).toEqual({ label: "All managers", to: {} });
    expect(step(owner, {})).toBeNull();
    expect(step(mira, { person: "bea" })).toEqual({ label: "Whole team", to: {} });
    expect(step(mira, {})).toBeNull();
    expect(step(bea, {})).toBeNull();
  });
});

describe("the actor list", () => {
  const labels = (viewer: Viewer, visible: LedgerPerson[], types: string[]) => actorOptions(visible, viewer, types).map((option) => option.label);

  it("gives the owner every manager and BDE, the AI agent and System", () => {
    expect(labels(owner, people.filter((row) => !row.isFormer), ["USER", "SYSTEM", "AGENT"])).toEqual(
      ["All actors", "Mira Rao", "Zed Rao", "Bea Rao", "Ben Rao", "Cara Rao", "Nia Rao", "AI agent", "System"]);
  });

  it("gives a manager their team and the AI agent, no System", () => {
    const team = [people[2], people[4], people[5]];
    expect(labels(mira, team, ["USER", "AGENT"])).toEqual(["All actors", "Mira Rao", "Bea Rao", "Ben Rao", "AI agent"]);
  });

  it("gives a BDE their own name and the AI agent", () => {
    expect(labels(bea, [people[4]], [])).toEqual(["All actors", "Bea Rao", "AI agent"]);
  });

  it("marks someone who left", () => {
    expect(labels(owner, [people[8]], [])).toContain("Old Rao (former)");
  });
});

describe("titles", () => {
  const title = (viewer: Viewer, selection: { team?: string; person?: string }) => viewTitle(buildRail(people, viewer, selection, 30), viewer, selection, people);

  it("names the view", () => {
    expect(title(owner, {})).toBe("Whole firm activity");
    expect(title(owner, { team: "mira" })).toBe("Mira Rao's team");
    expect(title(owner, { person: "bea" })).toBe("Bea Rao's activity");
    expect(title(mira, {})).toBe("Your team's activity");
    expect(title(mira, { person: "mira" })).toBe("Your actions");
    expect(title(bea, {})).toBe("Your actions");
  });
});

describe("the URL", () => {
  it("drops what doesn't parse", () => {
    const params = parseActivityParams(new URLSearchParams("type=BOSS&from=yesterday&page=-2&sort=name&dir=up"));
    expect(params).toEqual({ page: 1, sort: "when", dir: "desc" });
  });

  it("round-trips, leaving the defaults out", () => {
    const search = "person=user_bea&from=2026-11-01&to=2026-11-04&page=2";
    expect(serializeActivityParams(parseActivityParams(new URLSearchParams(search)))).toBe(search);
    expect(serializeActivityParams(parseActivityParams(new URLSearchParams()))).toBe("");
  });
});

describe("dates", () => {
  it("counts the quick ranges back from today", () => {
    const ranges = Object.fromEntries(presets("2026-11-06").map(({ label, range }) => [label, range]));
    expect(ranges["Yesterday"]).toEqual({ from: "2026-11-05", to: "2026-11-05" });
    expect(ranges["Last 7 days"]).toEqual({ from: "2026-10-31", to: "2026-11-06" });
    expect(ranges["This month"]).toEqual({ from: "2026-11-01", to: "2026-11-06" });
  });

  it("labels a range", () => {
    expect(rangeLabel({})).toBe("All time");
    expect(rangeLabel({ from: "2026-11-01", to: "2026-11-01" })).toBe("Nov 1");
    expect(rangeLabel({ from: "2026-11-01", to: "2026-11-04" })).toBe("Nov 1 – Nov 4");
  });
});
