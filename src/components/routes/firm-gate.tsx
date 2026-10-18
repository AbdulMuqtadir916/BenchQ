"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/app/error-state";
import { NotFoundState } from "@/components/app/not-found-state";
import { SuspendedState } from "@/components/app/suspended-state";
import { useFirmBySlug } from "@/lib/hooks/use-session";
import { hrefFor } from "@/lib/routes/registry";
import { useIsSessionSettling, useSession } from "@/lib/stores/session-store";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { firmOutcome, type FirmLookup, type FirmOutcome } from "@/lib/tenancy/firm-outcome";
import { GateScreen, GateSkeleton } from "./gate-screen";
import { SupportRequiredState } from "./support-required-state";

/**
 * The firm layout's gate (docs/07 §2.5): resolves the URL's slug and renders the page only for a
 * member of an open firm, inside its FirmProvider. Signed out → sign-in with returnTo; an unknown
 * firm or someone else's → not-found; a suspended firm → the suspended screen.
 * Client-side until there is a server session (Phase D): this shapes the UI, it is not security.
 */
export function FirmGate({ slug, children }: { slug: string; children: ReactNode }) {
  const router = useRouter();
  const principal = useSession((s) => s.principal);
  // A sign-in or cross-firm switch is landing on this URL: its session commits right after this render.
  const isSessionPending = useIsSessionSettling();
  const query = useFirmBySlug(slug);
  const lookup: FirmLookup = query.isSuccess ? { status: "success", firm: query.data } : query.isError ? { status: "error", error: query.error } : { status: "pending" };
  const outcome: FirmOutcome = isSessionPending ? { kind: "resolving" } : firmOutcome(principal, lookup);

  useEffect(() => {
    if (outcome.kind !== "signed-out") return;
    const returnTo = `${window.location.pathname}${window.location.search}`;
    router.replace(hrefFor("sign-in", {}, { returnTo }));
  }, [outcome.kind, router]);

  switch (outcome.kind) {
    case "signed-out":
      return <GateSkeleton label="Opening sign-in" />;
    case "resolving":
      return <GateSkeleton label="Opening workspace" />;
    case "support-required":
      return (
        <GateScreen>
          <SupportRequiredState />
        </GateScreen>
      );
    case "not-found":
      return (
        <GateScreen>
          <NotFoundState />
        </GateScreen>
      );
    case "error":
      return (
        <GateScreen>
          <ErrorState error={outcome.error} onRetry={() => void query.refetch()} variant="page" />
        </GateScreen>
      );
    case "suspended":
      return (
        <GateScreen>
          <SuspendedState firmName={outcome.firm.name} />
        </GateScreen>
      );
    case "open":
      return <FirmProvider firm={outcome.firm}>{children}</FirmProvider>;
  }
}
