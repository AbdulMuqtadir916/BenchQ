"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { NewCandidateForm } from "@/components/app/candidate/new-candidate-form";
import { Card } from "@/components/ui/card";
import { PageTransition } from "@/components/layout/page-transition";

export default function NewCandidatePage() {
  const router = useRouter();
  return (
    <PageTransition className="bq-page">
      <PageHeader title="New candidate" subtitle="Intake a new candidate onto the bench." />
      <Card className="mt-6 max-w-2xl p-6">
        <NewCandidateForm idPrefix="new-candidate" onCancel={() => router.back()} />
      </Card>
    </PageTransition>
  );
}
