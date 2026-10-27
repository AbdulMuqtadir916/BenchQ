import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLES, ROUTES, accessFor, accessForPath, activeNavId, canOpen, hrefFor, isRouteActive, landingFor, matchRoute, navFor, paletteRoutesFor, routeById, shortcutsFor, supportAccess, type Access, type RouteId } from "./registry";
import { RESERVED_SLUGS } from "@/lib/schemas/tenancy";
import type { FirmRole } from "@/lib/schemas/enums";
import type { Principal } from "@/lib/schemas/tenancy";
import { isInScope } from "./scope";

const APP_DIR = fileURLToPath(new URL("../../app", import.meta.url));

/** A firm user of the given role: the registry's helpers take a principal (docs/07 §5). */
const asRole = (role: FirmRole): Principal => ({ kind: "firm", userId: "u", firmId: "f", role });

/** A firm slug for building URLs in tests. */
const S = "acme";
/** A firm URL: `f("/candidates")` is "/acme/candidates". */
const f = (path: string) => `/${S}${path}`;

/**
 * Every page.tsx under src/app as a route path, skipping parallel (@slot) and intercepting ((.)) routes
 * and catch-alls ([...x]): those only exist to render a not-found inside an area's layout.
 */
function pagePaths(dir = APP_DIR): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith("@") || name.startsWith("(.)") || name.startsWith("[...")) return [];
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
    for (const url of ["/dashboard", "/candidates", "/candidates/[id]", "/jobs", "/applications", "/resumes", "/resumes/[id]", "/outreach", "/followups", "/analytics", "/ledger", "/settings/team", "/focus", "/welcome"]) {
      expect(pages, url).toContain(`/[firm]${url}`);
    }
  });

  it("puts every firm route under /[firm]/ and nothing else there (docs/07 §2.2, T6)", () => {
    for (const route of ROUTES) {
      expect(route.path.startsWith("/[firm]/"), route.id).toBe(route.area === "firm");
    }
    expect(ROUTES.filter((route) => route.area === "public").map((route) => route.path)).toEqual(["/", "/sign-in", "/invite/[token]"]);
  });

  it("reserves every top-level static segment, so no firm slug can shadow a route (docs/07 §2.4)", () => {
    const topLevel = new Set(pagePaths().map((path) => path.split("/")[1]!).filter((segment) => segment && !segment.startsWith("[")));
    expect([...topLevel].sort()).toEqual(["admin", "dev", "invite", "sign-in"]);
    for (const segment of topLevel) expect(RESERVED_SLUGS as readonly string[], segment).toContain(segment);
  });

  it("matches no slug-less URL from before T6: /candidates and the rest are not-found, not redirected", () => {
    for (const route of ROUTES.filter((item) => item.area === "firm")) {
      const old = route.path.replace("/[firm]", "").replace(/\[[^\]]+\]/g, "x");
      expect(matchRoute(old), old).toBeNull();
    }
  });

  it("has unique ids and paths", () => {
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length);
  });

  it("gives every role a landing route it can open, in its firm; an OWNER's first run opens welcome (T7)", () => {
    for (const role of ROLES) {
      for (const isFirstRun of [false, true]) {
        const landing = routeById(landingFor(asRole(role), { isFirstRun }));
        expect(landing.area).toBe("firm");
        expect(canOpen(landing, asRole(role)), `${role} ${isFirstRun}`).toBe(true);
      }
    }
    expect(landingFor(asRole("OWNER"), { isFirstRun: true })).toBe("welcome");
    expect(landingFor(asRole("OWNER"))).toBe("dashboard");
    expect((["MANAGER", "BDE", "VIEWER"] as const).map((role) => landingFor(asRole(role), { isFirstRun: true }))).toEqual(["dashboard", "dashboard", "dashboard"]);
  });

  it("prefers static segments over dynamic ones", () => {
    expect(matchRoute(f("/candidates/new"))?.id).toBe("candidates.new");
    expect(matchRoute(f("/candidates/cand_01"))?.id).toBe("candidates.detail");
    expect(matchRoute(f("/jobs/capture"))?.id).toBe("jobs.capture");
    expect(matchRoute(f("/resumes/new"))?.id).toBe("resumes.studio");
    expect(matchRoute(f("/settings/team?x=1"))?.id).toBe("settings.team");
    expect(matchRoute("/sign-in")?.id).toBe("sign-in");
    expect(matchRoute("/dev/design-system")?.id).toBe("design-system");
    expect(matchRoute("/nope")).toBeNull();
    expect(matchRoute(f(""))).toBeNull();
  });

  it("only shows nav items a role can open", () => {
    expect(navFor(asRole("BDE"), "workspace").map((r) => r.id)).not.toContain("analytics");
    expect(navFor(asRole("VIEWER"), "workspace").map((r) => r.id)).not.toContain("followups");
    expect(navFor(asRole("MANAGER"), "settings").map((r) => r.id)).toEqual(["settings.team", "settings.templates", "settings.preferences"]);
    expect(navFor(asRole("BDE"), "settings").map((r) => r.id)).toEqual(["settings.preferences"]);
  });
});

describe("record scope", () => {
  it("applies assigned and own scopes", () => {
    expect(isInScope("assigned", "u1", { bdeId: "u1" })).toBe(true);
    expect(isInScope("assigned", "u3", { bdeId: "u1" })).toBe(false);
    expect(isInScope("assigned", "u3", { bdeId: null })).toBe(false);
    expect(isInScope("team", "m1", { bdeId: "u1", managerId: "m1" })).toBe(true);   // 07 Q47: a MANAGER's candidate
    expect(isInScope("team", "m1", { bdeId: null, managerId: "m1" })).toBe(true);   // their queue
    expect(isInScope("team", "m1", { bdeId: "u2", managerId: "m2" })).toBe(false);  // another team's → not-found
    expect(isInScope("own", "u1", { ownerUserId: "u1" })).toBe(true);
    expect(isInScope("own", "u1", { ownerUserId: "u2" })).toBe(false);
    expect(isInScope("read", "u1", {})).toBe(true);
    expect(isInScope("none", "u1", { ownerUserId: "u1" })).toBe(false);
  });
});

describe("hrefFor", () => {
  it("returns the path for public and dev routes, which have no firm", () => {
    expect(hrefFor("root")).toBe("/");
    expect(hrefFor("sign-in", {}, { returnTo: "/acme/jobs?x=1" })).toBe("/sign-in?returnTo=%2Facme%2Fjobs%3Fx%3D1");
    expect(hrefFor("design-system")).toBe("/dev/design-system");
  });

  it("fills [firm] and [param] segments and encodes them", () => {
    expect(hrefFor("dashboard", { firm: S })).toBe("/acme/dashboard");
    expect(hrefFor("settings.preferences", { firm: S })).toBe("/acme/settings/preferences");
    expect(hrefFor("candidates.detail", { firm: S, id: "cand_01" })).toBe("/acme/candidates/cand_01");
    expect(hrefFor("resumes.studio", { firm: S, id: "new" })).toBe("/acme/resumes/new");
    expect(hrefFor("jobs.detail", { firm: S, id: "a/b" })).toBe("/acme/jobs/a%2Fb");
  });

  it("appends a query string and skips undefined values", () => {
    expect(hrefFor("candidates.detail", { firm: S, id: "cand_01" }, { tab: "inbox" })).toBe("/acme/candidates/cand_01?tab=inbox");
    expect(hrefFor("jobs", { firm: S }, { candidate: "cand_01", q: undefined })).toBe("/acme/jobs?candidate=cand_01");
    expect(hrefFor("applications", { firm: S }, { bde: undefined })).toBe("/acme/applications");
  });

  it("throws when a param is missing, the firm included: a firm link is never slug-less", () => {
    expect(() => hrefFor("candidates.detail", { firm: S })).toThrow(/missing the "id" param/);
    expect(() => hrefFor("dashboard")).toThrow(/missing the "firm" param/);
  });

  it("accepts a route object, as the sidebar and palette hold", () => {
    expect(hrefFor(routeById("followups"), { firm: S })).toBe("/acme/followups");
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
 * Paths are under `/[firm]` (T6). "→ landing" and "—" are `none`.
 * This table is the spec: change docs/07 first, then this table, then the registry.
 */
const FIRM_TABLE: ReadonlyArray<readonly [RouteId, Access, Access, Access, Access]> = [
  ["welcome", "full", "none", "none", "none"], // OWNER first run; others → landing
  ["dashboard", "full", "full", "full", "read"],
  ["candidates", "full", "team", "assigned", "read"],
  ["candidates.new", "full", "full", "none", "none"], // 07 Q41: a BDE no longer adds candidates
  ["candidates.detail", "full", "team", "assigned", "read"],
  ["jobs", "full", "full", "full", "read"],
  ["jobs.detail", "full", "full", "full", "read"],
  ["jobs.capture", "full", "full", "full", "none"],
  ["applications", "full", "team", "own", "read"],
  ["applications.detail", "full", "team", "own", "read"],
  ["resumes", "full", "team", "assigned", "read"],
  ["resumes.studio", "full", "team", "assigned", "read"],
  ["outreach", "full", "team", "own", "read"],
  ["followups", "full", "team", "own", "none"],
  ["focus", "full", "full", "full", "none"],
  ["analytics", "full", "team", "none", "read"],
  ["ledger", "full", "team", "own", "read"],
  ["settings", "full", "full", "full", "full"], // index: redirects to the first allowed section
  ["settings.firm", "full", "none", "none", "none"],
  ["settings.team", "full", "team", "none", "none"], // MANAGER: their team, read-only + assign through can() (Q15, Q47)
  ["settings.templates", "full", "full", "none", "none"],
  ["settings.preferences", "full", "full", "full", "full"],
];

/** Routes outside the firm table: public pages, and the dev-only design system (docs/07 §2.1, §2.4). */
const PUBLIC_ROUTES: readonly RouteId[] = ["root", "sign-in", "invite"];
const DEV_ROUTES: readonly RouteId[] = ["design-system"];
/** docs/07 §2.3: PLATFORM_ADMIN only, every route of the list (P3). */
const PLATFORM_ROUTES: readonly RouteId[] = [
  "admin", "admin.firms", "admin.firms.new", "admin.firms.detail", "admin.firms.detail.users", "admin.firms.detail.plan", "admin.firms.detail.activity",
  "admin.plans", "admin.audit", "admin.system", "admin.team",
];

describe("access table (docs/07 §2.2)", () => {
  it("has a row for every firm route, and only for routes that exist", () => {
    const covered = new Set<string>([...FIRM_TABLE.map(([id]) => id), ...PUBLIC_ROUTES, ...DEV_ROUTES, ...PLATFORM_ROUTES]);
    expect(ROUTES.filter((route) => !covered.has(route.id)).map((route) => route.id)).toEqual([]);
    expect(FIRM_TABLE.filter(([id]) => !ROUTES.some((route) => route.id === id)).map(([id]) => id)).toEqual([]);
    expect(new Set(FIRM_TABLE.map(([id]) => id)).size).toBe(FIRM_TABLE.length);
  });

  it.each(FIRM_TABLE)("%s: OWNER %s · MANAGER %s · BDE %s · VIEWER %s", (id, ...expected) => {
    const route = routeById(id);
    const actual = ROLES.map((role: FirmRole) => accessFor(route, asRole(role)));
    expect(actual).toEqual(expected);
    // Every role is covered, and canOpen agrees with "none".
    ROLES.forEach((role, index) => expect(canOpen(route, asRole(role))).toBe(expected[index] !== "none"));
  });

  it("sends a denied role to the landing route only for /welcome; everywhere else the Forbidden screen shows in place (Q2, Q4)", () => {
    for (const [id] of FIRM_TABLE) {
      expect(routeById(id).onDenied, id).toBe(id === "welcome" ? "landing" : undefined);
    }
  });

  it("leaves public routes open to every role", () => {
    for (const id of PUBLIC_ROUTES) {
      expect(routeById(id).access).toEqual({ kind: "public" });
      for (const role of ROLES) expect(accessFor(routeById(id), asRole(role))).toBe("full");
    }
  });

  it("marks dev routes dev-only, under /dev, and closed to every role outside development", () => {
    for (const id of DEV_ROUTES) {
      const route = routeById(id);
      expect(route.devOnly).toBe(true);
      expect(route.path.startsWith("/dev/")).toBe(true);
      // vitest runs with NODE_ENV=test and no NEXT_PUBLIC_SHOW_DEV_ROUTES
      for (const role of ROLES) expect(canOpen(route, asRole(role))).toBe(false);
    }
  });
});

describe("accessForPath (fails closed)", () => {
  it("is none for a path that matches no route, for every role", () => {
    for (const role of ROLES) {
      for (const path of ["/nope", "/candidates", f("/candidates/cand_01/extra"), "/admin/nope", f("/settings/unknown"), f("/dashboard/x"), f("")]) {
        expect(accessForPath(path, asRole(role)), `${role} ${path}`).toEqual({ route: null, access: "none" });
      }
    }
  });

  it("returns the route's own access for registered paths, ignoring query and hash", () => {
    expect(accessForPath(f("/analytics?range=7d"), asRole("BDE"))).toEqual({ route: routeById("analytics"), access: "none" });
    expect(accessForPath(f("/candidates/cand_01#notes"), asRole("BDE")).access).toBe("assigned");
    expect(accessForPath(f("/resumes/new"), asRole("VIEWER")).access).toBe("read");
  });
});

describe("no public sign-up (docs/07 Q11)", () => {
  it("has no /sign-up route: unregistered, closed to every role, and no page for it", () => {
    expect(matchRoute("/sign-up")).toBeNull();
    expect(ROUTES.some((route) => route.id === "sign-up" || route.path === "/sign-up")).toBe(false);
    for (const role of ROLES) expect(accessForPath("/sign-up", asRole(role))).toEqual({ route: null, access: "none" });
    expect(pagePaths()).not.toContain("/sign-up");
  });
});

describe("isRouteActive (matches on route ids, not paths)", () => {
  it("is active on the route itself and on its children", () => {
    expect(isRouteActive("candidates", f("/candidates"))).toBe(true);
    expect(isRouteActive("candidates", f("/candidates/new"))).toBe(true);
    expect(isRouteActive("candidates", f("/candidates/cand_01"))).toBe(true);
    expect(isRouteActive("candidates", f("/candidates/cand_01?tab=inbox"))).toBe(true);
    expect(isRouteActive("jobs", f("/jobs/capture"))).toBe(true);
    expect(isRouteActive("applications", f("/applications/app_001"))).toBe(true);
    expect(isRouteActive("resumes", f("/resumes/res_9"))).toBe(true);
    expect(isRouteActive("settings", f("/settings/team"))).toBe(true);
  });

  it("is not active elsewhere, including on siblings that share a name prefix", () => {
    expect(isRouteActive("candidates", f("/jobs"))).toBe(false);
    expect(isRouteActive("jobs", f("/candidates/cand_01"))).toBe(false);
    expect(isRouteActive("settings.team", f("/settings/firm"))).toBe(false);
    expect(isRouteActive("settings.team", f("/settings/team"))).toBe(true);
    expect(isRouteActive("settings.team", f("/settings"))).toBe(false);
    expect(isRouteActive("applications", f("/applications-archive"))).toBe(false);
  });

  it("is never active on a path that is not a registered route", () => {
    for (const id of ROUTES.map((route) => route.id as RouteId)) {
      expect(isRouteActive(id, "/nope")).toBe(false);
      expect(isRouteActive(id, f("/candidates/cand_01/extra"))).toBe(false);
      expect(isRouteActive(id, "/candidates")).toBe(false);
    }
  });

  it("gives each sidebar item exactly one active route on every registered page", () => {
    for (const page of ROUTES) {
      const params = Object.fromEntries([...page.path.matchAll(/\[([^\]]+)\]/g)].map((m) => [m[1]!, "x"]));
      const url = hrefFor(page.id as RouteId, params);
      const items = ROUTES.filter((route) => route.nav?.section === "workspace" || route.nav?.section === "preferences");
      const active = items.filter((route) => isRouteActive(route.id as RouteId, url)).map((route) => route.id);
      expect(active.length, `${url} -> ${active.join(",")}`).toBeLessThanOrEqual(1);
    }
  });

  it("relies on a naming convention: every dotted id has a registered parent id", () => {
    const ids = new Set(ROUTES.map((route) => route.id));
    for (const id of ids) {
      if (!id.includes(".")) continue;
      expect(ids.has(id.slice(0, id.lastIndexOf("."))), `${id} has no parent route`).toBe(true);
    }
  });
});

/**
 * docs/07 §2.2 "Support" column: a platform admin inside a read-only support view. Derived (read where
 * OWNER has access) except acting and personal routes; `welcome` sends them to the landing.
 */
const SUPPORT_TABLE: ReadonlyArray<readonly [RouteId, Access]> = [
  ["welcome", "none"], ["dashboard", "read"], ["candidates", "read"], ["candidates.new", "none"], ["candidates.detail", "read"],
  ["jobs", "read"], ["jobs.detail", "read"], ["jobs.capture", "none"], ["applications", "read"], ["applications.detail", "read"],
  ["resumes", "read"], ["resumes.studio", "read"], ["outreach", "read"], ["followups", "read"], ["focus", "none"],
  ["analytics", "read"], ["ledger", "read"], ["settings", "read"], ["settings.firm", "read"], ["settings.team", "read"],
  ["settings.templates", "read"], ["settings.preferences", "none"],
];

const admin: Principal = { kind: "platform", userId: "padm", role: "PLATFORM_ADMIN", support: null };
const inSupport: Principal = { ...admin, support: { id: "sv", firmId: "f", reason: "Investigating a report", startedAt: "2026-10-18T12:00:00.000Z", expiresAt: "2026-10-18T13:00:00.000Z" } };

describe("platform tier (docs/07 §2.3, §2.2 Support, P1)", () => {
  it("opens platform routes to a platform admin only; every firm role gets none (the admin layout shows not-found)", () => {
    for (const id of PLATFORM_ROUTES) {
      const route = routeById(id);
      expect(route.area).toBe("platform");
      expect(route.path === "/admin" || route.path.startsWith("/admin/")).toBe(true);
      expect(accessFor(route, admin)).toBe("full");
      expect(accessFor(route, inSupport)).toBe("full");
      for (const role of ROLES) expect(accessFor(route, asRole(role)), role).toBe("none");
    }
  });

  it("covers every firm route in the Support table", () => {
    expect(SUPPORT_TABLE.map(([id]) => id).sort()).toEqual(FIRM_TABLE.map(([id]) => id).sort());
  });

  it.each(SUPPORT_TABLE)("%s: support view %s; a platform admin without one gets none", (id, expected) => {
    const route = routeById(id);
    expect(supportAccess(route)).toBe(expected);
    expect(accessFor(route, inSupport)).toBe(expected);
    expect(accessFor(route, admin)).toBe("none");
  });

  it("lands a platform admin on /admin and gives them only the admin nav", () => {
    expect(landingFor(admin)).toBe("admin");
    expect(hrefFor(landingFor(admin))).toBe("/admin");
    expect(navFor(admin, "admin").map((route) => route.id)).toEqual(["admin", "admin.firms", "admin.plans", "admin.audit", "admin.system", "admin.team"]);
    expect(navFor(admin, "workspace")).toEqual([]);
    for (const role of ROLES) expect(navFor(asRole(role), "admin"), role).toEqual([]);
  });
});

describe("admin nav and keys (docs/04 §14.1)", () => {
  it("lists every §2.3 route under /admin, with admin URLs keyed by firmId (not slug)", () => {
    expect(ROUTES.filter((route) => route.area === "platform").map((route) => route.id).sort()).toEqual([...PLATFORM_ROUTES].sort());
    expect(hrefFor("admin.firms.detail.users", { firmId: "firm_hts" })).toBe("/admin/firms/firm_hts/users");
    expect(matchRoute("/admin/firms/new")?.id).toBe("admin.firms.new");
    expect(matchRoute("/admin/firms/firm_hts")?.id).toBe("admin.firms.detail");
  });

  it("has the admin g-map g o · g f · g p · g a · g s · g t, only in the admin shell; the firm map stays the firm's", () => {
    const keys = (principal: Principal, area: "firm" | "platform") => Object.fromEntries(shortcutsFor(principal, area).map(({ key, route }) => [key, route.id]));
    expect(keys(admin, "platform")).toEqual({ o: "admin", f: "admin.firms", p: "admin.plans", a: "admin.audit", s: "admin.system", t: "admin.team" });
    expect(keys(admin, "firm")).toEqual({});
    expect(keys(inSupport, "firm")).toEqual({ d: "dashboard", c: "candidates", j: "jobs", a: "applications", f: "followups" });
    expect(keys(asRole("OWNER"), "firm")).toMatchObject({ a: "applications", f: "followups" });
    expect(keys(asRole("OWNER"), "platform")).toEqual({});
  });

  it("keeps g keys unique within an area", () => {
    for (const area of ["firm", "platform"] as const) {
      const keys = ROUTES.filter((route) => route.area === area && route.shortcut).map((route) => route.shortcut);
      expect(new Set(keys).size, area).toBe(keys.length);
    }
  });

  it("lights exactly one admin nav item on every admin page: the most specific (Overview only on /admin)", () => {
    const nav = navFor(admin, "admin");
    expect(activeNavId(nav, "/admin")).toBe("admin");
    expect(activeNavId(nav, "/admin/firms")).toBe("admin.firms");
    expect(activeNavId(nav, "/admin/firms/firm_hts/plan")).toBe("admin.firms");
    expect(activeNavId(nav, "/admin/audit?firm=firm_hts")).toBe("admin.audit");
    expect(activeNavId(nav, "/admin/nope")).toBeNull();
  });
});

describe("⌘K navigation by area (P5, docs/04 §14.1)", () => {
  const ids = (principal: Principal, area: "firm" | "platform") => paletteRoutesFor(principal, area).map((route) => route.id).sort();

  it("a platform admin in the admin shell: the admin pages, nothing of a firm", () => {
    expect(ids(admin, "platform")).toEqual(["admin", "admin.audit", "admin.firms", "admin.plans", "admin.system", "admin.team"]);
    expect(ids(admin, "firm")).toEqual([]);
  });

  it("inside a support view: only firm pages it can open (read), no admin pages, no personal ones", () => {
    const pages = ids(inSupport, "firm");
    expect(pages).toContain("dashboard");
    expect(pages).toContain("ledger");
    expect(pages).not.toContain("settings.preferences"); // personal: none in a support view
    expect(pages.every((id) => !id.startsWith("admin"))).toBe(true);
    for (const id of pages) expect(accessFor(routeById(id), inSupport), id).toBe("read");
  });

  it("a firm user never gets admin pages", () => {
    for (const role of ROLES) expect(ids(asRole(role), "platform"), role).toEqual([]);
  });
});

