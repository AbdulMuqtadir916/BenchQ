import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";

/**
 * /admin — placeholder until P3, which builds the overview (firm count by status, seats used vs sold,
 * active users, AI spend; all derived) from the docs/04 Admin section and the multi-card pattern in
 * docs/04 §13. P2 only needs a page so the shell and the platform guard can be checked.
 */
export default function AdminOverviewPage() {
  return (
    <div className="bq-page">
      <PageHeader title="Overview" subtitle="The platform at a glance." />
      <EmptyState
        icon={LayoutDashboard}
        variant="first-run"
        title="The overview is being specified"
        description="Firm counts, seat usage, active users and AI spend arrive once the admin screens are specified."
      />
    </div>
  );
}
