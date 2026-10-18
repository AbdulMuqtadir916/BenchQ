"use client";

import { Ban, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { PrincipalSwitcher } from "@/components/dev/principal-switcher";
import { useSignOut } from "@/lib/hooks/use-session";

/**
 * docs/07 §2.5: a SUSPENDED firm's users see this on every route, with no shell and none of the
 * firm's data. Only BenchQ can reactivate a firm, so the one action is signing out.
 */
export function SuspendedState({ firmName }: { firmName: string }) {
  const signOut = useSignOut();
  return (
    <div className="w-full max-w-lg">
      <div className="mb-4 flex justify-center">
        <PrincipalSwitcher />
      </div>
      <EmptyState
        icon={Ban}
        variant="error"
        title="Workspace suspended"
        description={`The BenchQ workspace for ${firmName} is suspended. Contact your BenchQ account manager to restore access.`}
        action={
          <Button variant="secondary" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            <LogOut size={14} aria-hidden />
            {signOut.isPending ? "Signing out…" : "Sign out"}
          </Button>
        }
      />
    </div>
  );
}
