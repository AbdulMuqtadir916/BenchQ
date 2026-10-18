"use client";

import { usePathname } from "next/navigation";
import { matchRoute } from "@/lib/routes/registry";
import { useSession } from "@/lib/stores/session-store";

/**
 * The document title for every route, from the registry. Rendered once in the root layout;
 * React 19 hoists <title> into <head>. The root layout sets no metadata title, so this is the only one.
 * A platform route names itself only to a platform admin: anyone else sees the not-found, and a tab
 * titled "Overview" would confirm the admin area exists (docs/07 principle 4).
 */
export function RouteTitle() {
  const route = matchRoute(usePathname() ?? "/");
  const isPlatformAdmin = useSession((s) => s.principal?.kind === "platform");
  const isNamed = route && route.title !== "BenchQ" && (route.area !== "platform" || isPlatformAdmin);
  const title = isNamed ? `${route.title} · BenchQ` : "BenchQ";
  return <title>{title}</title>;
}
