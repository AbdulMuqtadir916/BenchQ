import {
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  FileText,
  LayoutDashboard,
  Mail,
  ScrollText,
  Send,
  Settings,
  SlidersHorizontal,
  SwatchBook,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { FirmRole } from "@/lib/stores/session-store";

/**
 * The single list of routes and who may open them (docs/07-ROUTES-AND-RBAC.md §2).
 * Sidebar, command palette, `g` shortcuts, page titles and the route guard all
 * read from here. Adding a page means adding it here — registry.test.ts fails otherwise.
 */

export type Access = "full" | "assigned" | "own" | "read" | "none";
export type RoleAccess = Record<FirmRole, Access>;

export interface RouteDef {
  id: string;
  /** Same syntax as the app folder, route groups removed: "/candidates/[id]". */
  path: string;
  title: string;
  shell: "auth" | "app" | "studio" | "focus";
  access: RoleAccess | "public";
  /** What a role with "none" sees. Default: the Forbidden screen in place. */
  onDenied?: "forbidden" | "landing";
  nav?: { section: "workspace" | "preferences" | "settings"; order: number; icon?: LucideIcon };
  /** Second key of a `g` shortcut, e.g. "c" for `g c`. */
  shortcut?: string;
  palette?: boolean;
  devOnly?: boolean;
}

export const ROLES: readonly FirmRole[] = ["OWNER", "MANAGER", "BDE", "VIEWER"];

const everyone = (access: Access): RoleAccess => ({ OWNER: access, MANAGER: access, BDE: access, VIEWER: access });
const roles = (OWNER: Access, MANAGER: Access, BDE: Access, VIEWER: Access): RoleAccess => ({ OWNER, MANAGER, BDE, VIEWER });

export const ROUTES: readonly RouteDef[] = [
  // Auth and onboarding
  { id: "root", path: "/", title: "BenchQ", shell: "auth", access: "public" },
  { id: "sign-in", path: "/sign-in", title: "Sign in", shell: "auth", access: "public" },
  { id: "sign-up", path: "/sign-up", title: "Create account", shell: "auth", access: "public" },
  { id: "welcome", path: "/welcome", title: "Welcome", shell: "auth", access: roles("full", "none", "none", "none"), onDenied: "landing" },

  // Workspace
  { id: "dashboard", path: "/dashboard", title: "Dashboard", shell: "app", access: roles("full", "full", "full", "read"), nav: { section: "workspace", order: 1, icon: LayoutDashboard }, shortcut: "d", palette: true },
  { id: "candidates", path: "/candidates", title: "Candidates", shell: "app", access: roles("full", "full", "assigned", "read"), nav: { section: "workspace", order: 2, icon: Users }, shortcut: "c", palette: true },
  { id: "candidates.new", path: "/candidates/new", title: "New candidate", shell: "app", access: roles("full", "full", "full", "none") },
  { id: "candidates.detail", path: "/candidates/[id]", title: "Candidate", shell: "app", access: roles("full", "full", "assigned", "read") },
  { id: "jobs", path: "/jobs", title: "Jobs", shell: "app", access: roles("full", "full", "full", "read"), nav: { section: "workspace", order: 3, icon: Briefcase }, shortcut: "j", palette: true },
  { id: "jobs.capture", path: "/jobs/capture", title: "Capture job", shell: "app", access: roles("full", "full", "full", "none") },
  { id: "jobs.detail", path: "/jobs/[id]", title: "Job", shell: "app", access: roles("full", "full", "full", "read") },
  { id: "applications", path: "/applications", title: "Applications", shell: "app", access: roles("full", "full", "own", "read"), nav: { section: "workspace", order: 4, icon: Send }, shortcut: "a", palette: true },
  { id: "applications.detail", path: "/applications/[id]", title: "Application", shell: "app", access: roles("full", "full", "own", "read") },
  { id: "resumes", path: "/resumes", title: "Resume Builder", shell: "app", access: roles("full", "full", "assigned", "read"), nav: { section: "workspace", order: 5, icon: FileText }, palette: true },
  { id: "resumes.studio", path: "/resumes/[id]", title: "Resume", shell: "studio", access: roles("full", "full", "assigned", "read") },
  { id: "outreach", path: "/outreach", title: "Outreach", shell: "app", access: roles("full", "full", "own", "read"), nav: { section: "workspace", order: 6, icon: Mail }, palette: true },
  { id: "followups", path: "/followups", title: "Follow-ups", shell: "app", access: roles("full", "full", "own", "none"), nav: { section: "workspace", order: 7, icon: Bell }, shortcut: "f", palette: true },
  { id: "analytics", path: "/analytics", title: "Analytics", shell: "app", access: roles("full", "full", "none", "read"), nav: { section: "workspace", order: 8, icon: BarChart3 }, palette: true },
  { id: "ledger", path: "/ledger", title: "Ledger", shell: "app", access: roles("full", "full", "own", "read"), nav: { section: "workspace", order: 9, icon: ScrollText }, palette: true },
  { id: "focus", path: "/focus", title: "Focus mode", shell: "focus", access: roles("full", "full", "full", "none") },

  // Preferences
  { id: "design-system", path: "/design-system", title: "Design system", shell: "app", access: everyone("full"), nav: { section: "preferences", order: 1, icon: SwatchBook }, devOnly: true },
  { id: "settings", path: "/settings", title: "Settings", shell: "app", access: everyone("full"), nav: { section: "preferences", order: 2, icon: Settings }, palette: true },
  { id: "settings.firm", path: "/settings/firm", title: "Firm", shell: "app", access: roles("full", "none", "none", "none"), nav: { section: "settings", order: 1, icon: Building2 }, palette: true },
  { id: "settings.team", path: "/settings/team", title: "Team", shell: "app", access: roles("full", "full", "none", "none"), nav: { section: "settings", order: 2, icon: Users }, palette: true },
  { id: "settings.templates", path: "/settings/templates", title: "Templates", shell: "app", access: roles("full", "full", "none", "none"), nav: { section: "settings", order: 3, icon: FileText }, palette: true },
  { id: "settings.preferences", path: "/settings/preferences", title: "Preferences", shell: "app", access: everyone("full"), nav: { section: "settings", order: 4, icon: SlidersHorizontal }, palette: true },
];

const BY_ID = new Map(ROUTES.map((route) => [route.id, route]));

export function routeById(id: string): RouteDef {
  const route = BY_ID.get(id);
  if (!route) throw new Error(`Unknown route id: ${id}`);
  return route;
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

export function accessFor(route: RouteDef, role: FirmRole): Access {
  return route.access === "public" ? "full" : route.access[role];
}

export function canOpen(route: RouteDef, role: FirmRole): boolean {
  if (route.devOnly && !devRoutesEnabled()) return false;
  return accessFor(route, role) !== "none";
}

export function navFor(role: FirmRole, section: NonNullable<RouteDef["nav"]>["section"]): RouteDef[] {
  return ROUTES.filter((route) => route.nav?.section === section && canOpen(route, role)).sort(
    (a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0),
  );
}

export function paletteRoutesFor(role: FirmRole): RouteDef[] {
  return ROUTES.filter((route) => route.palette && canOpen(route, role));
}

export function shortcutsFor(role: FirmRole): { key: string; route: RouteDef }[] {
  return ROUTES.filter((route) => route.shortcut && canOpen(route, role)).map((route) => ({ key: route.shortcut!, route }));
}

export function landingFor(role: FirmRole): string {
  return canOpen(routeById("dashboard"), role) ? "/dashboard" : "/settings/preferences";
}
