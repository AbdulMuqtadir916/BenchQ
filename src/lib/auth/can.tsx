"use client";

import type { ReactNode } from "react";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import type { RouteDef } from "@/lib/routes/registry";
import { can, type Action } from "./policy";

/**
 * Render `children` only if the signed-in principal may take the action (or open the route):
 * `<Can action="firm.suspend">…</Can>`, `<Can route={routeById("analytics")}>…</Can>`. A control the
 * principal can't use is not rendered at all (docs/04 §0), so `fallback` is for the two §0 exceptions and
 * for read-only alternatives, never for a disabled copy of the control.
 */
export function Can({ action, route, children, fallback = null }: ({ action: Action; route?: never } | { route: RouteDef; action?: never }) & { children: ReactNode; fallback?: ReactNode }) {
  const principal = useSignedInPrincipal();
  const isAllowed = route ? can(principal, "route.view", route) : can(principal, action!);
  return <>{isAllowed ? children : fallback}</>;
}
