"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { hrefFor } from "@/lib/routes/registry";
import { useIsSessionSettling, useSession } from "@/lib/stores/session-store";
import { GateSkeleton } from "./gate-screen";

/** For signed-in pages outside a firm (/dev): signed out → sign-in with returnTo, like the firm gate. UX, not security. */
export function SignedInGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isSignedIn = useSession((s) => s.principal !== null);
  const isSessionPending = useIsSessionSettling();

  useEffect(() => {
    if (isSignedIn || isSessionPending) return;
    router.replace(hrefFor("sign-in", {}, { returnTo: `${window.location.pathname}${window.location.search}` }));
  }, [isSignedIn, isSessionPending, router]);

  return isSignedIn ? <>{children}</> : <GateSkeleton label="Opening sign-in" />;
}
