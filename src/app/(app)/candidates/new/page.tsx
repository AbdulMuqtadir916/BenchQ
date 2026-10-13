"use client";

import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageTransition } from "@/components/layout/page-transition";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useHref } from "@/lib/routes/use-href";

export default function NewCandidatePage() {
  const toHref = useHref();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // simulate submit
    setTimeout(() => {
      router.push(toHref("candidates"));
    }, 1500);
  };

  return (
    <PageTransition className="bq-page">
      <PageHeader title="New Candidate" subtitle="Intake a new candidate into the pipeline." />
      <div className="max-w-2xl mt-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card className="p-6 space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-label" htmlFor="name">Full Name</label>
                <Input id="name" className="bq-input" placeholder="e.g. Jane Doe" required />
              </div>
              <div className="space-y-2">
                <label className="text-label" htmlFor="title">Target Role / Title</label>
                <Input id="title" className="bq-input" placeholder="e.g. Senior Frontend Engineer" required />
              </div>
              <div className="space-y-2">
                <label className="text-label" htmlFor="email">Email</label>
                <Input id="email" type="email" className="bq-input" placeholder="jane@example.com" required />
              </div>
              <div className="space-y-2">
                <label className="text-label" htmlFor="phone">Phone</label>
                <Input id="phone" type="tel" className="bq-input" placeholder="(555) 123-4567" />
              </div>
            </div>
            
            <div className="pt-4 flex justify-end gap-3 border-t">
              <Button variant="secondary" type="button" onClick={() => router.back()}>Cancel</Button>
              <Button className="bq-primary" type="submit" disabled={loading}>
                {loading ? "Saving..." : "Save Candidate"}
              </Button>
            </div>
          </Card>
        </form>
      </div>
    </PageTransition>
  );
}
