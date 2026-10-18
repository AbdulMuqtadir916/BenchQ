"use client";

import { ModalRoute } from "@/components/layout/modal-route";
import { PageHeader } from "@/components/app/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewCandidateModal() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // simulate submit
    setTimeout(() => {
      // Typically router.back() to close the modal after save,
      // or redirect to the candidate's page
      router.back();
    }, 1500);
  };

  return (
    <ModalRoute>
      <div className="pt-2">
        <PageHeader title="New Candidate" subtitle="Intake a new candidate into the pipeline." />
      </div>
      <form onSubmit={handleSubmit} className="space-y-6 mt-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-label" htmlFor="modal-name">Full Name</label>
            <Input id="modal-name" className="bq-input" placeholder="e.g. Jane Doe" required />
          </div>
          <div className="space-y-2">
            <label className="text-label" htmlFor="modal-title">Target Role / Title</label>
            <Input id="modal-title" className="bq-input" placeholder="e.g. Senior Frontend Engineer" required />
          </div>
          <div className="space-y-2">
            <label className="text-label" htmlFor="modal-email">Email</label>
            <Input id="modal-email" type="email" className="bq-input" placeholder="jane@example.com" required />
          </div>
          <div className="space-y-2">
            <label className="text-label" htmlFor="modal-phone">Phone</label>
            <Input id="modal-phone" type="tel" className="bq-input" placeholder="(555) 123-4567" />
          </div>
        </div>
        
        <div className="pt-4 flex justify-end gap-3 border-t">
          <Button variant="secondary" type="button" onClick={() => router.back()}>Cancel</Button>
          <Button className="bq-primary" type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save Candidate"}
          </Button>
        </div>
      </form>
    </ModalRoute>
  );
}
