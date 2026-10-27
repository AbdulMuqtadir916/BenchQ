"use client";

import { Suspense } from "react";
import { CandidateWizard } from "@/components/app/candidate-wizard/wizard";
import { SkeletonCard } from "@/components/app/skeleton-card";

/**
 * New candidate (docs/candidate-onboarding/05-assign-and-reassign.md §4, 07 Q48): the five-step flow on its own page,
 * without the sidebar. Suspense because the step lives in `?step=` (useSearchParams).
 */
export default function NewCandidatePage() {
  return (
    <main className="flex min-h-screen flex-col bg-[var(--color-surface)]">
      <Suspense fallback={<div className="bq-page"><SkeletonCard /></div>}>
        <CandidateWizard />
      </Suspense>
    </main>
  );
}
