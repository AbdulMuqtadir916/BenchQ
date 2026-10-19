import { Suspense } from "react";
import { FirmPlanTab } from "@/features/admin/firm/plan-tab";

/** /admin/firms/[firmId]/plan (docs/04 §14.5). */
export default function AdminFirmPlanPage() {
  return (
    <Suspense>
      <FirmPlanTab />
    </Suspense>
  );
}
