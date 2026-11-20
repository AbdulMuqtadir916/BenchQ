import { Skeleton } from "@/components/ui/skeleton";

/** The Autofill tab while its answers load, in the tab's own shape: the topics, the header, then cards of rows. */
export function AutofillSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading autofill answers" className="mx-auto flex w-full max-w-6xl gap-8 px-4 pb-10 pt-5 sm:px-6">
      <div className="hidden w-52 shrink-0 space-y-2 lg:block">
        {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-6 w-full" />)}
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-1.5 w-full" />
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 3 }, (_, card) => (
          <div key={card} className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"><Skeleton className="h-4 w-32" /></div>
            {Array.from({ length: 3 }, (_, row) => (
              <div key={row} className="space-y-2 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0">
                <Skeleton className="h-3 w-56" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
