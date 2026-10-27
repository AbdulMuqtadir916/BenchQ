"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isCandidateWizardEnabled } from "@/lib/flags";
import { ModalRoute } from "@/components/layout/modal-route";
import { PageHeader } from "@/components/app/page-header";
import { NewCandidateForm } from "@/components/app/candidate/new-candidate-form";

export default function NewCandidateModal() {
  const router = useRouter();
  const isWizard = isCandidateWizardEnabled();
  // The new flow is a full page (07 Q48): behind its flag, load the page instead of this dialog. Module 05 deletes
  // this intercept.
  useEffect(() => {
    if (isWizard) window.location.replace(window.location.href);
  }, [isWizard]);
  if (isWizard) return null;
  return (
    <ModalRoute routeId="candidates.new" labelledBy="new-candidate-modal-title">
      <div className="pt-2">
        <PageHeader title="New candidate" subtitle="Intake a new candidate onto the bench." titleId="new-candidate-modal-title" />
      </div>
      <div className="mt-6">
        <NewCandidateForm idPrefix="modal-candidate" onCancel={() => router.back()} />
      </div>
    </ModalRoute>
  );
}
