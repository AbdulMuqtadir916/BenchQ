"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/app/error-state";
import { useCurrentSession } from "@/lib/hooks/use-session";
import { landingHref } from "@/lib/routes/landing";
import { hrefFor } from "@/lib/routes/registry";
import { useSession } from "@/lib/stores/session-store";
import { GateScreen, GateSkeleton } from "./gate-screen";

/**
 * `/` (docs/07 §2.1, T7): signed out → sign-in; a firm user → their own firm's landing (an OWNER's first
 * run → welcome); a platform admin → /admin.
 */
export function Landing() {
  const router = useRouter();
  const isSignedIn = useSession((s) => s.principal !== null);
  const isSessionPending = useSession((s) => s.pending !== null);
  const session = useCurrentSession();
  const target = isSessionPending ? null : !isSignedIn || session.data === null ? hrefFor("sign-in") : session.data ? landingHref(session.data) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (session.isError) {
    return (
      <GateScreen>
        <ErrorState error={session.error} onRetry={() => void session.refetch()} variant="page" />
      </GateScreen>
    );
  }
  return <GateSkeleton label="Opening BenchQ" />;
}
