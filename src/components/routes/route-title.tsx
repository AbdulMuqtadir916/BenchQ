"use client";

import { usePathname } from "next/navigation";
import { matchRoute } from "@/lib/routes/registry";

/**
 * The document title for every route, from the registry. Rendered once in the root layout;
 * React 19 hoists <title> into <head>. The root layout sets no metadata title, so this is the only one.
 */
export function RouteTitle() {
  const route = matchRoute(usePathname() ?? "/");
  const title = route && route.title !== "BenchQ" ? `${route.title} · BenchQ` : "BenchQ";
  return <title>{title}</title>;
}
