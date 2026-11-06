import { Suspense } from "react";
import { SkeletonTable } from "@/components/app/skeleton-table";
import { ActivityPage } from "@/features/activity/activity-page";

export default function LedgerPage() {
  return (
    <Suspense fallback={<div className="bq-page"><SkeletonTable /></div>}>
      <ActivityPage />
    </Suspense>
  );
}
