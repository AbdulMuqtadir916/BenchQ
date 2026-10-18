"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { NotFoundState } from "@/components/app/not-found-state";
import { hrefFor } from "@/lib/routes/registry";
import { useIsSessionSettling, useSession } from "@/lib/stores/session-store";
import { GateScreen, GateSkeleton } from "./gate-screen";

/**
 * The admin layout's gate (docs/07 §2.3, P2): `/admin/…` renders only for a PLATFORM_ADMIN. Signed out
 * → sign-in with returnTo; anyone else → not-found, never Forbidden, so the admin area's existence
 * isn't confirmed (principle 4). Client-side until Phase D: this shapes the UI, it is not security.
 */
const subscribeNever = () => () => {};

export function PlatformGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  // The server renders the default session, not the browser's: decide only once hydrated, so the
  // server's HTML is never a not-found for someone who is in fact an admin here (dev session restore).
  const isHydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const principal = useSession((s) => s.principal);
  const isSessionPending = useIsSessionSettling();
  const isSignedOut = isHydrated && principal === null && !isSessionPending;

  useEffect(() => {
    if (isSignedOut) router.replace(hrefFor("sign-in", {}, { returnTo: `${window.location.pathname}${window.location.search}` }));
  }, [isSignedOut, router]);

  if (!isHydrated || isSessionPending || principal === null) return <GateSkeleton label={isSignedOut ? "Opening sign-in" : "Opening admin"} />;
  if (principal.kind !== "platform") {
    return (
      <GateScreen>
        <NotFoundState />
      </GateScreen>
    );
  }
  return <>{children}</>;
}
