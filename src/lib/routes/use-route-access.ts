"use client";

import { usePathname } from "next/navigation";
import { useSignedInUser } from "@/lib/stores/session-store";
import { accessForPath, type Access, type RouteDef } from "./registry";

/** The current route and the signed-in role's access to it. An unregistered path is `none` (fails closed). */
export function useRouteAccess(): { route: RouteDef | null; access: Access } {
  const pathname = usePathname() ?? "/";
  const role = useSignedInUser().role;
  return accessForPath(pathname, role);
}
