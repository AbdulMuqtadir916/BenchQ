import { Activity } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DemoDataCard } from "@/features/admin/demo-data-card";

/**
 * /admin/system (docs/04 §14.9, 07 Q29): a placeholder until the HealthCheck, ScraperRun and AiUsage
 * contracts are approved. It holds the demo data's reset meanwhile (docs/03 §3.3).
 */
export default function AdminSystemPage() {
  return (
    <div className="bq-page">
      <PageHeader title="System" subtitle="Backend health, scraper runs and AI spend." />
      <EmptyState
        icon={Activity}
        variant="first-run"
        title="Being specified"
        description="Backend health, scraper runs and AI spend by firm and model arrive once their data contracts are approved."
      />
      <div className="mt-6 max-w-2xl">
        <DemoDataCard />
      </div>
    </div>
  );
}
