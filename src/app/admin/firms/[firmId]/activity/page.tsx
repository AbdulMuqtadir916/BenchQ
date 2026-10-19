import { Suspense } from "react";
import { FirmActivityTab } from "@/features/admin/firm/activity-tab";

/** /admin/firms/[firmId]/activity (docs/04 §14.5). */
export default function AdminFirmActivityPage() {
  return (
    <Suspense>
      <FirmActivityTab />
    </Suspense>
  );
}
