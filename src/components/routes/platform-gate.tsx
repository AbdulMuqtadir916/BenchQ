"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { NotFoundState } from "@/components/app/not-found-state";
import { hrefFor } from "@/lib/routes/registry";
import { useSession } from "@/lib/stores/session-store";
import { GateScreen, GateSkeleton } from "./gate-screen";

/**
 * The admin layout's gate (docs/07 §2.3, P2): `/admin/…` renders only for a PLATFORM_ADMIN. Signed out
 * → sign-in with returnTo; anyone else → not-found, never Forbidden, so the admin area's existence
 * isn't confirmed (principle 4). Client-side until Phase D: this shapes the UI, it is not security.
 */
export function PlatformGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const principal = useSession((s) => s.principal);
  const isSessionPending = useSession((s) => s.pending !== null);
  const isSignedOut = principal === null && !isSessionPending;

  useEffect(() => {
    if (isSignedOut) router.replace(hrefFor("sign-in", {}, { returnTo: `${window.location.pathname}${window.location.search}` }));
  }, [isSignedOut, router]);

  if (isSessionPending || principal === null) return <GateSkeleton label={isSignedOut ? "Opening sign-in" : "Opening admin"} />;
  if (principal.kind !== "platform") {
    return (
      <GateScreen>
        <NotFoundState />
      </GateScreen>
    );
  }
  return <>{children}</>;
}
