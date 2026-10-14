import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLES, ROUTES, accessFor, accessForPath, canOpen, hrefFor, landingFor, matchRoute, navFor, routeById, type Access, type RouteId } from "./registry";
import type { FirmRole } from "@/lib/schemas/enums";
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

  it("keeps every URL when pages sit in route groups ((workspace), (manage), (app), (studio))", () => {
    const pages = pagePaths();
    expect(pages.some((path) => path.includes("(") || path.includes(")"))).toBe(false);
    for (const url of ["/dashboard", "/candidates", "/candidates/[id]", "/jobs", "/applications", "/resumes", "/outreach", "/followups", "/analytics", "/ledger", "/settings/team"]) {
      expect(pages, url).toContain(url);
    }
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

/**
 * docs/07 §2.2, firm roles only. One row per route, columns OWNER · MANAGER · BDE · VIEWER.
 * The path column drops `/[firm]`: Phase T adds it. "→ landing" and "—" are `none`.
 * This table is the spec: change docs/07 first, then this table, then the registry.
 */
const FIRM_TABLE: ReadonlyArray<readonly [RouteId, Access, Access, Access, Access]> = [
  ["welcome", "full", "none", "none", "none"], // OWNER first run; others → landing
  ["dashboard", "full", "full", "full", "read"],
  ["candidates", "full", "full", "assigned", "read"],
  ["candidates.new", "full", "full", "full", "none"],
  ["candidates.detail", "full", "full", "assigned", "read"],
  ["jobs", "full", "full", "full", "read"],
  ["jobs.detail", "full", "full", "full", "read"],
  ["jobs.capture", "full", "full", "full", "none"],
  ["applications", "full", "full", "own", "read"],
  ["applications.detail", "full", "full", "own", "read"],
  ["resumes", "full", "full", "assigned", "read"],
  ["resumes.studio", "full", "full", "assigned", "read"],
  ["outreach", "full", "full", "own", "read"],
  ["followups", "full", "full", "own", "none"],
  ["focus", "full", "full", "full", "none"],
  ["analytics", "full", "full", "none", "read"],
  ["ledger", "full", "full", "own", "read"],
  ["settings", "full", "full", "full", "full"], // index: redirects to the first allowed section
  ["settings.firm", "full", "none", "none", "none"],
  ["settings.team", "full", "full", "none", "none"],
  ["settings.templates", "full", "full", "none", "none"],
  ["settings.preferences", "full", "full", "full", "full"],
];

/** Routes outside the firm table: public pages, and the dev-only design system (docs/07 §2.1, §2.4). */
const PUBLIC_ROUTES: readonly RouteId[] = ["root", "sign-in"];
const DEV_ROUTES: readonly RouteId[] = ["design-system"];

describe("access table (docs/07 §2.2)", () => {
  it("has a row for every firm route, and only for routes that exist", () => {
    const covered = new Set<string>([...FIRM_TABLE.map(([id]) => id), ...PUBLIC_ROUTES, ...DEV_ROUTES]);
    expect(ROUTES.filter((route) => !covered.has(route.id)).map((route) => route.id)).toEqual([]);
    expect(FIRM_TABLE.filter(([id]) => !ROUTES.some((route) => route.id === id)).map(([id]) => id)).toEqual([]);
    expect(new Set(FIRM_TABLE.map(([id]) => id)).size).toBe(FIRM_TABLE.length);
  });

  it.each(FIRM_TABLE)("%s: OWNER %s · MANAGER %s · BDE %s · VIEWER %s", (id, ...expected) => {
    const route = routeById(id);
    const actual = ROLES.map((role: FirmRole) => accessFor(route, role));
    expect(actual).toEqual(expected);
    // Every role is covered, and canOpen agrees with "none".
    ROLES.forEach((role, index) => expect(canOpen(route, role)).toBe(expected[index] !== "none"));
  });

  it("sends a denied role to the landing route only for /welcome; everywhere else the Forbidden screen shows in place (Q2, Q4)", () => {
    for (const [id] of FIRM_TABLE) {
      expect(routeById(id).onDenied, id).toBe(id === "welcome" ? "landing" : undefined);
    }
  });

  it("leaves public routes open to every role", () => {
    for (const id of PUBLIC_ROUTES) {
      expect(routeById(id).access).toBe("public");
      for (const role of ROLES) expect(accessFor(routeById(id), role)).toBe("full");
    }
  });

  it("marks dev routes dev-only, under /dev, and closed to every role outside development", () => {
    for (const id of DEV_ROUTES) {
      const route = routeById(id);
      expect(route.devOnly).toBe(true);
      expect(route.path.startsWith("/dev/")).toBe(true);
      // vitest runs with NODE_ENV=test and no NEXT_PUBLIC_SHOW_DEV_ROUTES
      for (const role of ROLES) expect(canOpen(route, role)).toBe(false);
    }
  });
});

describe("accessForPath (fails closed)", () => {
  it("is none for a path that matches no route, for every role", () => {
    for (const role of ROLES) {
      for (const path of ["/nope", "/candidates/cand_01/extra", "/admin", "/settings/unknown", "/dashboard/x"]) {
        expect(accessForPath(path, role), `${role} ${path}`).toEqual({ route: null, access: "none" });
      }
    }
  });

  it("returns the route's own access for registered paths, ignoring query and hash", () => {
    expect(accessForPath("/analytics?range=7d", "BDE")).toEqual({ route: routeById("analytics"), access: "none" });
    expect(accessForPath("/candidates/cand_01#notes", "BDE").access).toBe("assigned");
    expect(accessForPath("/resumes/new", "VIEWER").access).toBe("read");
  });
});

describe("no public sign-up (docs/07 Q11)", () => {
  it("has no /sign-up route: unregistered, closed to every role, and no page for it", () => {
    expect(matchRoute("/sign-up")).toBeNull();
    expect(ROUTES.some((route) => route.id === "sign-up" || route.path === "/sign-up")).toBe(false);
    for (const role of ROLES) expect(accessForPath("/sign-up", role)).toEqual({ route: null, access: "none" });
    expect(pagePaths()).not.toContain("/sign-up");
  });
});
