"use client";

import { useRouter } from "next/navigation";
import { ModalRoute } from "@/components/layout/modal-route";
import { PageHeader } from "@/components/app/page-header";
import { NewCandidateForm } from "@/components/app/candidate/new-candidate-form";

export default function NewCandidateModal() {
  const router = useRouter();
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
