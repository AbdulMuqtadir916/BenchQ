import { Card } from "@/components/ui/card";
import { JobCaptureForm } from "@/components/app/jobs/job-capture-form";
import { PageTransition } from "@/components/layout/page-transition";

export default function JobCapturePage() {
  return (
    <PageTransition className="bq-page">
      <Card className="mx-auto max-w-3xl p-6">
        <JobCaptureForm />
      </Card>
    </PageTransition>
  );
}
