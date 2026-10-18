"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ForbiddenState } from "@/components/app/forbidden-state";
import { NotFoundState } from "@/components/app/not-found-state";
import { landingFor } from "@/lib/routes/registry";
import { useRouteAccess } from "@/lib/routes/use-route-access";
import { useSession } from "@/lib/stores/session-store";

/**
 * Renders the page only if the current role may open it (docs/07 Phase A4).
 * Client-side only until there is a server session (Phase D): this shapes the UI, it is not security.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const role = useSession((s) => s.user.role);
  const { route, access } = useRouteAccess();
  const isDenied = access === "none";
  const shouldLeave = isDenied && route?.onDenied === "landing";

  useEffect(() => {
    if (shouldLeave) router.replace(landingFor(role));
  }, [shouldLeave, role, router]);

  // docs/04 §12: a principal switch never leaves the previous principal's data on screen. That is
  // handled once, for the whole app, by the query provider (src/lib/query/principal-boundary.ts).

  if (shouldLeave) return null;
  // Not a route we know: render nothing of the page, and don't pretend it exists (docs/07 principle 4).
  if (!route) return <NotFoundState />;
  if (isDenied) return <ForbiddenState role={role} pageTitle={route.title} />;
  return <>{children}</>;
}
