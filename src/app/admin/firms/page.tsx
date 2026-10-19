import { Suspense } from "react";
import { FirmsList } from "@/features/admin/firms/firms-list";

/** /admin/firms (docs/04 §14.3). useSearchParams needs a Suspense boundary for the static build. */
export default function AdminFirmsPage() {
  return (
    <Suspense>
      <FirmsList />
    </Suspense>
  );
}
