"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageTransition } from "@/components/layout/page-transition";
import { CheckCircle2 } from "lucide-react";
import { useFinishFirstRun } from "@/lib/hooks/use-session";

/**
 * An OWNER's first run (docs/07 T7). Leaving it marks the user active (lastActiveAt), so from then on
 * they land on the dashboard. Any later way out of this page (a skip, a setup step) uses the same hook.
 */
export default function WelcomePage() {
  const finish = useFinishFirstRun();

  return (
    <PageTransition className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-4">
      <Card className="w-full max-w-lg p-8 shadow-lg text-center">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-[var(--color-success-bg)] text-[var(--color-success-fg)] rounded-full flex items-center justify-center">
            <CheckCircle2 size={32} />
          </div>
        </div>
        
        <h1 className="text-display text-[var(--color-text)] mb-4">Welcome to BenchQ</h1>
        <p className="text-body text-[var(--color-text-2)] mb-8">
          Your account is set up. You can now start managing candidates, finding matching jobs, and tracking applications.
        </p>
        
        <Button onClick={() => finish.mutate()} disabled={finish.isPending} className="bq-primary w-full max-w-[200px]">
          {finish.isPending ? "Opening…" : "Go to Dashboard"}
        </Button>
        {finish.isError ? (
          <p role="alert" className="mt-4 text-sm text-[var(--color-danger-fg)]">Couldn&apos;t finish setup. Try again.</p>
        ) : null}
      </Card>
    </PageTransition>
  );
}
