import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLES, ROUTES, accessFor, canOpen, hrefFor, landingFor, matchRoute, navFor, routeById, type RouteId } from "./registry";
import { isInScope } from "./scope";

const APP_DIR = fileURLToPath(new URL("../../app", import.meta.url));

/** Every page.tsx under src/app as a route path, skipping parallel (@slot) and intercepting ((.)) routes. */
function pagePaths(dir = APP_DIR): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith("@") || name.startsWith("(.)")) return [];
      return pagePaths(full);
    }
    if (name !== "page.tsx") return [];
    const route = relative(APP_DIR, dir)
      .split(sep)
      .filter((segment) => segment && !(segment.startsWith("(") && segment.endsWith(")")));
    return [`/${route.join("/")}`];
  });
}

describe("route registry", () => {
  it("has an entry for every page, and a page for every entry", () => {
    const pages = pagePaths().sort();
    const registered = ROUTES.map((route) => route.path).sort();
    expect(registered).toEqual(pages);
  });

  it("has unique ids and paths", () => {
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length);
  });

  it("gives every role a landing route it can open", () => {
    for (const role of ROLES) {
      const landing = matchRoute(landingFor(role));
      expect(landing && canOpen(landing, role)).toBe(true);
    }
  });

  it("prefers static segments over dynamic ones", () => {
    expect(matchRoute("/candidates/new")?.id).toBe("candidates.new");
    expect(matchRoute("/candidates/cand_01")?.id).toBe("candidates.detail");
    expect(matchRoute("/jobs/capture")?.id).toBe("jobs.capture");
    expect(matchRoute("/resumes/new")?.id).toBe("resumes.studio");
    expect(matchRoute("/settings/team?x=1")?.id).toBe("settings.team");
    expect(matchRoute("/nope")).toBeNull();
  });

  it("matches the access table in docs/07", () => {
    expect(accessFor(routeById("analytics"), "BDE")).toBe("none");
    expect(accessFor(routeById("followups"), "VIEWER")).toBe("none");
    expect(accessFor(routeById("candidates.detail"), "BDE")).toBe("assigned");
    expect(accessFor(routeById("applications.detail"), "BDE")).toBe("own");
    expect(accessFor(routeById("settings.firm"), "MANAGER")).toBe("none");
    expect(accessFor(routeById("focus"), "VIEWER")).toBe("none");
    expect(routeById("welcome").onDenied).toBe("landing");
  });

  it("only shows nav items a role can open", () => {
    expect(navFor("BDE", "workspace").map((r) => r.id)).not.toContain("analytics");
    expect(navFor("VIEWER", "workspace").map((r) => r.id)).not.toContain("followups");
    expect(navFor("MANAGER", "settings").map((r) => r.id)).toEqual(["settings.team", "settings.templates", "settings.preferences"]);
    expect(navFor("BDE", "settings").map((r) => r.id)).toEqual(["settings.preferences"]);
  });
});

describe("record scope", () => {
  it("applies assigned and own scopes", () => {
    expect(isInScope("assigned", "u1", { assignedUserIds: ["u1", "u2"] })).toBe(true);
    expect(isInScope("assigned", "u3", { assignedUserIds: ["u1"] })).toBe(false);
    expect(isInScope("own", "u1", { ownerUserId: "u1" })).toBe(true);
    expect(isInScope("own", "u1", { ownerUserId: "u2" })).toBe(false);
    expect(isInScope("read", "u1", {})).toBe(true);
    expect(isInScope("none", "u1", { ownerUserId: "u1" })).toBe(false);
  });
});

describe("hrefFor", () => {
  it("returns the path for static routes", () => {
    expect(hrefFor("dashboard")).toBe("/dashboard");
    expect(hrefFor("candidates.new")).toBe("/candidates/new");
    expect(hrefFor("settings.preferences")).toBe("/settings/preferences");
  });

  it("fills [param] segments and encodes them", () => {
    expect(hrefFor("candidates.detail", { id: "cand_01" })).toBe("/candidates/cand_01");
    expect(hrefFor("resumes.studio", { id: "new" })).toBe("/resumes/new");
    expect(hrefFor("jobs.detail", { id: "a/b" })).toBe("/jobs/a%2Fb");
  });

  it("appends a query string and skips undefined values", () => {
    expect(hrefFor("candidates.detail", { id: "cand_01" }, { tab: "inbox" })).toBe("/candidates/cand_01?tab=inbox");
    expect(hrefFor("jobs", {}, { candidate: "cand_01", q: undefined })).toBe("/jobs?candidate=cand_01");
    expect(hrefFor("applications", {}, { bde: undefined })).toBe("/applications");
  });

  it("throws when a param is missing", () => {
    expect(() => hrefFor("candidates.detail")).toThrow(/missing the "id" param/);
  });

  it("accepts a route object, as the sidebar and palette hold", () => {
    expect(hrefFor(routeById("followups"))).toBe("/followups");
  });

  it("round-trips: every route's link matches back to the same route", () => {
    for (const route of ROUTES) {
      const params = Object.fromEntries([...route.path.matchAll(/\[([^\]]+)\]/g)].map((m) => [m[1]!, "sample"]));
      expect(matchRoute(hrefFor(route.id as RouteId, params))?.id).toBe(route.id);
    }
  });
});
