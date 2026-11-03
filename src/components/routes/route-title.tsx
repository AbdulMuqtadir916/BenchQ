"use client";

import { usePathname } from "next/navigation";
import { devRoutesEnabled, matchRoute } from "@/lib/routes/registry";
import { useSession } from "@/lib/stores/session-store";

/**
 * The document title for every route, from the registry. Rendered once in the root layout;
 * React 19 hoists <title> into <head>. The root layout sets no metadata title, so this is the only one.
 * A platform-only route (the admin area, the design system) names itself only to a platform admin: anyone else
 * sees the not-found, and a tab titled "Overview" would confirm the page exists (docs/07 principle 4). A dev route
 * with dev routes off is not-found for everyone, so it isn't named either.
 */
export function RouteTitle() {
  const route = matchRoute(usePathname() ?? "/");
  const isPlatformAdmin = useSession((s) => s.principal?.kind === "platform");
  const isNamed = route && route.title !== "BenchQ" && (route.access.kind !== "platform" || isPlatformAdmin)
    && (!route.devOnly || devRoutesEnabled());
  const title = isNamed ? `${route.title} · BenchQ` : "BenchQ";
  return <title>{title}</title>;
}
