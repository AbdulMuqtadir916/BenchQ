"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
  const role = useSession((s) => s.user.role);
  const { route, access } = useRouteAccess();
  const isDenied = access === "none";
  const shouldLeave = isDenied && route?.onDenied === "landing";

  useEffect(() => {
    if (shouldLeave) router.replace(landingFor(role));
  }, [shouldLeave, role, router]);

  // docs/04 §12: switching who is signed in refetches instead of leaving the previous principal's data
  // on screen. Firm data is keyed by firm already; this covers user-specific lists (scopes, follow-ups).
  const userId = useSession((s) => s.principal.userId);
  const previousUser = useRef(userId);
  useEffect(() => {
    if (previousUser.current === userId) return;
    previousUser.current = userId;
    void queryClient.invalidateQueries();
  }, [userId, queryClient]);

  if (shouldLeave) return null;
  // Not a route we know: render nothing of the page, and don't pretend it exists (docs/07 principle 4).
  if (!route) return <NotFoundState />;
  if (isDenied) return <ForbiddenState role={role} pageTitle={route.title} />;
  return <>{children}</>;
}
