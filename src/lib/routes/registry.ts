import {
  Activity,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  FileText,
  Layers,
  LayoutDashboard,
  ShieldCheck,
  Mail,
  ScrollText,
  Send,
  Settings,
  SlidersHorizontal,
  SwatchBook,
  Users,
  type LucideIcon,
} from "lucide-react";
import { FirmRole } from "@/lib/schemas/enums";
import type { Principal } from "@/lib/schemas/tenancy";

/**
 * The single list of routes and who may open them (docs/07-ROUTES-AND-RBAC.md §2).
 * Sidebar, command palette, `g` shortcuts, page titles and the route guard all
 * read from here. Adding a page means adding it here — registry.test.ts fails otherwise.
 */

export type Access = "full" | "assigned" | "own" | "read" | "none";
export type RoleAccess = Record<FirmRole, Access>;

/**
 * docs/07 §5. `firm` routes live under `/[firm]/…` and render only inside the firm layout (§2.5);
 * `platform` routes live under `/admin` and render only inside the admin layout (PLATFORM_ADMIN only).
 */
export type Area = "public" | "firm" | "platform" | "dev";

/**
 * Who may open a route (docs/07 §5). Firm routes give each firm role an access level; a platform
 * admin reaches them only inside a read-only support view, with `support` (derived when absent: see
 * `supportAccess`). Platform routes are PLATFORM_ADMIN only. Public routes are open to everyone.
 */
export type RouteAccess = { kind: "public" } | { kind: "firm"; roles: RoleAccess; support?: Access } | { kind: "platform" };

export interface RouteDef {
  id: string;
  /** Same syntax as the app folder, route groups removed: "/[firm]/candidates/[id]". */
  path: string;
  title: string;
  area: Area;
  shell: "auth" | "app" | "studio" | "focus" | "admin";
  access: RouteAccess;
  /** What a role with "none" sees. Default: the Forbidden screen in place. */
  onDenied?: "forbidden" | "landing";
  nav?: { section: "workspace" | "preferences" | "settings" | "admin"; order: number; icon?: LucideIcon };
  /** Second key of a `g` shortcut, e.g. "c" for `g c`. */
  shortcut?: string;
  palette?: boolean;
  devOnly?: boolean;
}

export const ROLES: readonly FirmRole[] = FirmRole.options;

const everyone = (access: Access): RoleAccess => ({ OWNER: access, MANAGER: access, BDE: access, VIEWER: access });
const roles = (OWNER: Access, MANAGER: Access, BDE: Access, VIEWER: Access): RoleAccess => ({ OWNER, MANAGER, BDE, VIEWER });
const PUBLIC: RouteAccess = { kind: "public" };
const PLATFORM: RouteAccess = { kind: "platform" };
/** A firm route. `support` only where §2.2 overrides the derived Support column (acting and personal routes). */
const firm = (byRole: RoleAccess, support?: Access): RouteAccess => (support === undefined ? { kind: "firm", roles: byRole } : { kind: "firm", roles: byRole, support });

const ROUTE_DEFS = [
  // Auth and onboarding
  { id: "root", path: "/", title: "BenchQ", area: "public", shell: "auth", access: PUBLIC },
  { id: "sign-in", path: "/sign-in", title: "Sign in", area: "public", shell: "auth", access: PUBLIC },
  { id: "invite", path: "/invite/[token]", title: "Accept invite", area: "public", shell: "auth", access: PUBLIC },
  { id: "welcome", path: "/[firm]/welcome", title: "Welcome", area: "firm", shell: "auth", access: firm(roles("full", "none", "none", "none"), "none"), onDenied: "landing" },

  // Workspace
  { id: "dashboard", path: "/[firm]/dashboard", title: "Dashboard", area: "firm", shell: "app", access: firm(roles("full", "full", "full", "read")), nav: { section: "workspace", order: 1, icon: LayoutDashboard }, shortcut: "d", palette: true },
  { id: "candidates", path: "/[firm]/candidates", title: "Candidates", area: "firm", shell: "app", access: firm(roles("full", "full", "assigned", "read")), nav: { section: "workspace", order: 2, icon: Users }, shortcut: "c", palette: true },
  { id: "candidates.new", path: "/[firm]/candidates/new", title: "New candidate", area: "firm", shell: "app", access: firm(roles("full", "full", "full", "none"), "none") },
  { id: "candidates.detail", path: "/[firm]/candidates/[id]", title: "Candidate", area: "firm", shell: "app", access: firm(roles("full", "full", "assigned", "read")) },
  { id: "jobs", path: "/[firm]/jobs", title: "Jobs", area: "firm", shell: "app", access: firm(roles("full", "full", "full", "read")), nav: { section: "workspace", order: 3, icon: Briefcase }, shortcut: "j", palette: true },
  { id: "jobs.capture", path: "/[firm]/jobs/capture", title: "Capture job", area: "firm", shell: "app", access: firm(roles("full", "full", "full", "none"), "none") },
  { id: "jobs.detail", path: "/[firm]/jobs/[id]", title: "Job", area: "firm", shell: "app", access: firm(roles("full", "full", "full", "read")) },
  { id: "applications", path: "/[firm]/applications", title: "Applications", area: "firm", shell: "app", access: firm(roles("full", "full", "own", "read")), nav: { section: "workspace", order: 4, icon: Send }, shortcut: "a", palette: true },
  { id: "applications.detail", path: "/[firm]/applications/[id]", title: "Application", area: "firm", shell: "app", access: firm(roles("full", "full", "own", "read")) },
  { id: "resumes", path: "/[firm]/resumes", title: "Resume Builder", area: "firm", shell: "app", access: firm(roles("full", "full", "assigned", "read")), nav: { section: "workspace", order: 5, icon: FileText }, palette: true },
  { id: "resumes.studio", path: "/[firm]/resumes/[id]", title: "Resume", area: "firm", shell: "studio", access: firm(roles("full", "full", "assigned", "read")) },
  { id: "outreach", path: "/[firm]/outreach", title: "Outreach", area: "firm", shell: "app", access: firm(roles("full", "full", "own", "read")), nav: { section: "workspace", order: 6, icon: Mail }, palette: true },
  { id: "followups", path: "/[firm]/followups", title: "Follow-ups", area: "firm", shell: "app", access: firm(roles("full", "full", "own", "none")), nav: { section: "workspace", order: 7, icon: Bell }, shortcut: "f", palette: true },
  { id: "analytics", path: "/[firm]/analytics", title: "Analytics", area: "firm", shell: "app", access: firm(roles("full", "full", "none", "read")), nav: { section: "workspace", order: 8, icon: BarChart3 }, palette: true },
  { id: "ledger", path: "/[firm]/ledger", title: "Ledger", area: "firm", shell: "app", access: firm(roles("full", "full", "own", "read")), nav: { section: "workspace", order: 9, icon: ScrollText }, palette: true },
  { id: "focus", path: "/[firm]/focus", title: "Focus mode", area: "firm", shell: "focus", access: firm(roles("full", "full", "full", "none"), "none") },

  // Preferences
  { id: "design-system", path: "/dev/design-system", title: "Design system", area: "dev", shell: "app", access: PUBLIC, nav: { section: "preferences", order: 1, icon: SwatchBook }, devOnly: true },
  { id: "settings", path: "/[firm]/settings", title: "Settings", area: "firm", shell: "app", access: firm(everyone("full")), nav: { section: "preferences", order: 2, icon: Settings }, palette: true },
  { id: "settings.firm", path: "/[firm]/settings/firm", title: "Firm", area: "firm", shell: "app", access: firm(roles("full", "none", "none", "none")), nav: { section: "settings", order: 1, icon: Building2 }, palette: true },
  // TODO(Phase C, docs/07 Q15): OWNER manages the team (invite / remove / deactivate / change role); MANAGER may open this
  // page but it is read-only for them, plus assigning candidates to BDEs. `full` here only means "openable": the per-control
  // rules belong in can() (member.invite, member.remove, member.changeRole, member.deactivate, candidate.assign, team.view).
  // The page has no management controls today, so there is nothing to hide yet.
  { id: "settings.team", path: "/[firm]/settings/team", title: "Team", area: "firm", shell: "app", access: firm(roles("full", "full", "none", "none")), nav: { section: "settings", order: 2, icon: Users }, palette: true },
  { id: "settings.templates", path: "/[firm]/settings/templates", title: "Templates", area: "firm", shell: "app", access: firm(roles("full", "full", "none", "none")), nav: { section: "settings", order: 3, icon: FileText }, palette: true },
  { id: "settings.preferences", path: "/[firm]/settings/preferences", title: "Preferences", area: "firm", shell: "app", access: firm(everyone("full"), "none"), nav: { section: "settings", order: 4, icon: SlidersHorizontal }, palette: true },

  // Platform tier (docs/07 §2.3): PLATFORM_ADMIN only; everyone else gets not-found from the admin layout.
  // `g` keys here are the admin map (docs/04 §14.1): they apply only in the admin shell, so `g f` / `g a`
  // can mean Follow-ups / Applications in the firm area (shortcutsFor takes the area).
  { id: "admin", path: "/admin", title: "Overview", area: "platform", shell: "admin", access: PLATFORM, nav: { section: "admin", order: 1, icon: ShieldCheck }, shortcut: "o", palette: true },
  { id: "admin.firms", path: "/admin/firms", title: "Firms", area: "platform", shell: "admin", access: PLATFORM, nav: { section: "admin", order: 2, icon: Building2 }, shortcut: "f", palette: true },
  { id: "admin.firms.new", path: "/admin/firms/new", title: "New firm", area: "platform", shell: "admin", access: PLATFORM },
  { id: "admin.firms.detail", path: "/admin/firms/[firmId]", title: "Firm", area: "platform", shell: "admin", access: PLATFORM },
  { id: "admin.firms.detail.users", path: "/admin/firms/[firmId]/users", title: "Firm users", area: "platform", shell: "admin", access: PLATFORM },
  { id: "admin.firms.detail.plan", path: "/admin/firms/[firmId]/plan", title: "Firm plan", area: "platform", shell: "admin", access: PLATFORM },
  { id: "admin.firms.detail.activity", path: "/admin/firms/[firmId]/activity", title: "Firm activity", area: "platform", shell: "admin", access: PLATFORM },
  { id: "admin.plans", path: "/admin/plans", title: "Plans", area: "platform", shell: "admin", access: PLATFORM, nav: { section: "admin", order: 3, icon: Layers }, shortcut: "p", palette: true },
  { id: "admin.audit", path: "/admin/audit", title: "Audit", area: "platform", shell: "admin", access: PLATFORM, nav: { section: "admin", order: 4, icon: ScrollText }, shortcut: "a", palette: true },
  { id: "admin.system", path: "/admin/system", title: "System", area: "platform", shell: "admin", access: PLATFORM, nav: { section: "admin", order: 5, icon: Activity }, shortcut: "s", palette: true },
  { id: "admin.team", path: "/admin/team", title: "Team", area: "platform", shell: "admin", access: PLATFORM, nav: { section: "admin", order: 6, icon: Users }, shortcut: "t", palette: true },
] as const satisfies readonly RouteDef[];

/** Every registered route id. A mistyped id fails the typecheck instead of failing at render time. */
export type RouteId = (typeof ROUTE_DEFS)[number]["id"];

export const ROUTES: readonly RouteDef[] = ROUTE_DEFS;

const BY_ID = new Map<string, RouteDef>(ROUTES.map((route) => [route.id, route]));

export function routeById(id: string): RouteDef {
  const route = BY_ID.get(id);
  if (!route) throw new Error(`Unknown route id: ${id}`);
  return route;
}

export type RouteParams = Record<string, string | number>;
export type RouteQuery = Record<string, string | number | undefined>;

/**
 * The URL for a route id (or a route from the registry): `[param]` segments are filled from `params`, `query` is appended
 * (undefined values are skipped). The only place a path string is turned into a link.
 * Throws if a param is missing, `firm` included: components use `useHref()`, which fills the firm from
 * the URL's firm (docs/07 §5).
 */
export function hrefFor(target: RouteId | RouteDef, params: RouteParams = {}, query?: RouteQuery): string {
  const route = typeof target === "string" ? routeById(target) : target;
  const path = route.path.replace(/\[([^\]]+)\]/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`hrefFor("${route.id}") is missing the "${name}" param`);
    return encodeURIComponent(String(value));
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(key, String(value));
  }
  const queryString = search.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export function devRoutesEnabled(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_SHOW_DEV_ROUTES === "true";
}

const segments = (path: string) => path.split("/").filter(Boolean);
const isDynamic = (segment: string) => segment.startsWith("[") && segment.endsWith("]");

/** The route a pathname belongs to. Static segments beat dynamic ones: /candidates/new is not /candidates/[id]. */
export function matchRoute(pathname: string): RouteDef | null {
  const actual = segments(pathname.split(/[?#]/)[0] ?? "");
  let best: RouteDef | null = null;
  let bestDynamic = Infinity;
  for (const route of ROUTES) {
    const pattern = segments(route.path);
    if (pattern.length !== actual.length) continue;
    if (!pattern.every((segment, i) => isDynamic(segment) || segment === actual[i])) continue;
    const dynamic = pattern.filter(isDynamic).length;
    if (dynamic < bestDynamic) {
      best = route;
      bestDynamic = dynamic;
    }
  }
  return best;
}

/**
 * A platform admin's access to a firm route inside a read-only support view (docs/07 §2.2 "Support"):
 * `read` wherever OWNER has access, except where the route sets `support` (acting and personal routes
 * are `none`). Every action stays hidden whatever this says (§4; `can()` in Phase C).
 */
export function supportAccess(route: RouteDef): Access {
  if (route.access.kind !== "firm") return "none";
  if (route.access.support !== undefined) return route.access.support;
  return route.access.roles.OWNER === "none" ? "none" : "read";
}

export function accessFor(route: RouteDef, principal: Principal): Access {
  const access = route.access;
  switch (access.kind) {
    case "public":
      return "full";
    case "platform":
      return principal.kind === "platform" ? "full" : "none";
    case "firm":
      if (principal.kind === "firm") return access.roles[principal.role];
      return principal.support ? supportAccess(route) : "none";
  }
}

/**
 * The route a pathname belongs to and the principal's access to it. Fails closed: a path that matches
 * no registry entry is `none`, so nothing renders for it until it is registered (docs/07 A2.6).
 */
export function accessForPath(pathname: string, principal: Principal): { route: RouteDef | null; access: Access } {
  const route = matchRoute(pathname);
  return { route, access: route ? accessFor(route, principal) : "none" };
}

/**
 * Is `routeId` the page at `pathname`, or an ancestor of it? Matches on route ids, never on raw
 * paths, so it keeps working when paths gain `[firm]` (docs/07 Phase T). A dotted id is a child of
 * the id before its last dot: `candidates.detail` is under `candidates`, `settings.team` under
 * `settings` (registry.test.ts enforces that every dotted id has a registered parent).
 */
export function isRouteActive(routeId: RouteId, pathname: string): boolean {
  const current = matchRoute(pathname);
  if (!current) return false;
  return current.id === routeId || current.id.startsWith(`${routeId}.`);
}

/**
 * Which of `routes` (a nav list) is the current page's: the most specific one that `isRouteActive`.
 * The admin Overview is `admin`, the parent of every admin route, so it must not light up on /admin/firms.
 */
export function activeNavId(routes: readonly RouteDef[], pathname: string): string | null {
  let best: string | null = null;
  for (const route of routes) {
    if (isRouteActive(route.id as RouteId, pathname) && (best === null || route.id.length > best.length)) best = route.id;
  }
  return best;
}

export function canOpen(route: RouteDef, principal: Principal): boolean {
  if (route.devOnly && !devRoutesEnabled()) return false;
  return accessFor(route, principal) !== "none";
}

export function navFor(principal: Principal, section: NonNullable<RouteDef["nav"]>["section"]): RouteDef[] {
  return ROUTES.filter((route) => route.nav?.section === section && canOpen(route, principal)).sort(
    (a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0),
  );
}

/**
 * The ⌘K navigation where the principal is (docs/04 §14.1): firm routes in the firm area (a support view
 * included: only routes it can open, read-only), admin routes in the admin shell — never both.
 */
export function paletteRoutesFor(principal: Principal, area: "firm" | "platform"): RouteDef[] {
  return ROUTES.filter((route) => route.palette && route.area === area && canOpen(route, principal));
}

/**
 * The `g` shortcuts where the principal is: the firm map in the firm area (a support view included),
 * the admin map in the admin shell (docs/04 §14.1). Keys are unique within an area.
 */
export function shortcutsFor(principal: Principal, area: "firm" | "platform"): { key: string; route: RouteDef }[] {
  return ROUTES.filter((route) => route.shortcut && route.area === area && canOpen(route, principal)).map((route) => ({ key: route.shortcut!, route }));
}

/**
 * Where a principal lands (docs/07 §2.1, T7). A platform admin: the admin overview. A firm user: an
 * OWNER's first run opens the welcome page, everyone else the dashboard (or, failing that, their
 * preferences); fill `[firm]` with the user's own firm. "First run" = never active (`lastActiveAt`
 * null), true right after an OWNER accepts the firm's invite.
 */
export function landingFor(principal: Principal, options: { isFirstRun?: boolean } = {}): RouteId {
  if (principal.kind === "platform") return "admin";
  if (options.isFirstRun && canOpen(routeById("welcome"), principal)) return "welcome";
  return canOpen(routeById("dashboard"), principal) ? "dashboard" : "settings.preferences";
}
