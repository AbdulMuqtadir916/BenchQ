"use client";

import { usePathname } from "next/navigation";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { accessForPath, type Access, type RouteDef } from "./registry";

/** The current route and the signed-in principal's access to it. An unregistered path is `none` (fails closed). */
export function useRouteAccess(): { route: RouteDef | null; access: Access } {
  const pathname = usePathname() ?? "/";
  const principal = useSignedInPrincipal();
  return accessForPath(pathname, principal);
}
