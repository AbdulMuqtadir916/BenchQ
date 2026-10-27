"use client";

import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { NewCandidateForm } from "@/components/app/candidate/new-candidate-form";
import { CandidateWizard } from "@/components/app/candidate-wizard/wizard";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { Card } from "@/components/ui/card";
import { PageTransition } from "@/components/layout/page-transition";
import { isCandidateWizardEnabled } from "@/lib/flags";

export default function NewCandidatePage() {
  const router = useRouter();
  // The five-step flow (docs/candidate-onboarding/04-wizard-steps.md) behind its flag until module 05 replaces the form.
  if (isCandidateWizardEnabled()) {
    return (
      <Suspense fallback={<div className="bq-page"><SkeletonCard /></div>}>
        <CandidateWizard />
      </Suspense>
    );
  }
  return (
    <PageTransition className="bq-page">
      <PageHeader title="New candidate" subtitle="Intake a new candidate onto the bench." />
      <Card className="mt-6 max-w-2xl p-6">
        <NewCandidateForm idPrefix="new-candidate" onCancel={() => router.back()} />
      </Card>
    </PageTransition>
  );
}
