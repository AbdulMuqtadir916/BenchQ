import type { ReactNode } from "react";
import { SkeletonCard } from "@/components/app/skeleton-card";

/** Full-page frame for what a layout gate renders instead of a page: no shell, so nothing of the firm shows. */
export function GateScreen({ children }: { children: ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-4">{children}</main>;
}

/** While a gate works out who is signed in or which firm the URL names. */
export function GateSkeleton({ label }: { label: string }) {
  return (
    <GateScreen>
      <div className="w-full max-w-sm">
        <SkeletonCard aria-label={label} />
      </div>
    </GateScreen>
  );
}
