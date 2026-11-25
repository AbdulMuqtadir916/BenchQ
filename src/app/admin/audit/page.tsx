import { Suspense } from "react";
import { AdminActivityPage } from "@/features/admin/activity/admin-activity-page";

/** /admin/audit (docs/04 §14.7). */
export default function AdminAuditPage() {
  return (
    <Suspense>
      <AdminActivityPage />
    </Suspense>
  );
}
