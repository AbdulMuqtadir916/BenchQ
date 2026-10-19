import { Suspense } from "react";
import { AuditPage } from "@/features/admin/audit-page";

/** /admin/audit (docs/04 §14.7). */
export default function AdminAuditPage() {
  return (
    <Suspense>
      <AuditPage />
    </Suspense>
  );
}
