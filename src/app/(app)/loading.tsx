import { SkeletonCard } from "@/components/app/skeleton-card";

export default function AppLoading() {
  return (
    <div className="bq-page">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SkeletonCard aria-label="Loading page" />
        <SkeletonCard aria-label="Loading page" />
        <SkeletonCard aria-label="Loading page" />
        <SkeletonCard aria-label="Loading page" />
      </div>
    </div>
  );
}
