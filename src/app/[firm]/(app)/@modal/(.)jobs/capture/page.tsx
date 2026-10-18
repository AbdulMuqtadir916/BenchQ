import { JobCaptureForm } from "@/components/app/jobs/job-capture-form";
import { ModalRoute } from "@/components/layout/modal-route";

export default function CaptureJobModal() {
  return (
    <ModalRoute className="bq-dialog-wide" labelledBy="capture-job-title">
      <JobCaptureForm modal />
    </ModalRoute>
  );
}
