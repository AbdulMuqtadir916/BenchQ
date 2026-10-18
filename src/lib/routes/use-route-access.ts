"use client";

import { usePathname } from "next/navigation";
import { useSession } from "@/lib/stores/session-store";
import { accessFor, matchRoute, type Access, type RouteDef } from "./registry";

/** The current route and the signed-in role's access to it. Unregistered paths count as full access. */
export function useRouteAccess(): { route: RouteDef | null; access: Access } {
  const pathname = usePathname() ?? "/";
  const role = useSession((s) => s.user.role);
  const route = matchRoute(pathname);
  return { route, access: route ? accessFor(route, role) : "full" };
}
