"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/app/error-state";
import { useCurrentSession } from "@/lib/hooks/use-session";
import { landingHref } from "@/lib/routes/landing";
import { hrefFor } from "@/lib/routes/registry";
import { useIsSessionSettling, useSession } from "@/lib/stores/session-store";
import { GateScreen, GateSkeleton } from "./gate-screen";

/**
 * `/` (docs/07 §2.1, T7): signed out → sign-in; a firm user → their own firm's landing (an OWNER's first
 * run → welcome); a platform admin → /admin.
 */
export function Landing({mailboxFailed = false}: {mailboxFailed?: boolean}) {
  const router = useRouter();
  const [mailboxFailure, setMailboxFailure] = useState(mailboxFailed);
  const isSignedIn = useSession((s) => s.principal !== null);
  const isSessionPending = useIsSessionSettling();
  const session = useCurrentSession();
  const target = isSessionPending ? null : !isSignedIn || session.data === null ? hrefFor("sign-in") : session.data ? landingHref(session.data) : null;

  useEffect(() => {
    if (target && !mailboxFailure) router.replace(target);
  }, [target, router, mailboxFailure]);

  if (mailboxFailure) return <GateScreen><div className="space-y-3">
    <p role="alert">Google connection was not completed. Open the candidate’s Inbox and connect again.</p>
    <Button onClick={() => {window.history.replaceState(null, "", window.location.pathname); setMailboxFailure(false); if (target) router.replace(target);}}>Continue to BenchQ</Button>
  </div></GateScreen>;

  if (session.isError) {
    return (
      <GateScreen>
        <ErrorState error={session.error} onRetry={() => void session.refetch()} variant="page" />
      </GateScreen>
    );
  }
  return <GateSkeleton label="Opening BenchQ" />;
}
