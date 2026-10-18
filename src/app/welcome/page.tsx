"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageTransition } from "@/components/layout/page-transition";
import { CheckCircle2 } from "lucide-react";
import { useHref } from "@/lib/routes/use-href";

export default function WelcomePage() {
  const toHref = useHref();
  const router = useRouter();

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
        
        <Button onClick={() => router.push(toHref("dashboard"))} className="bq-primary w-full max-w-[200px]">
          Go to Dashboard
        </Button>
      </Card>
    </PageTransition>
  );
}
