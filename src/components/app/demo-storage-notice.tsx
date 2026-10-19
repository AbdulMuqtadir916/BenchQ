"use client";

import { HardDrive } from "lucide-react";
import { useDemoStorageFull } from "@/lib/hooks/use-demo-data";

/** The message itself, for the shell and for tests. */
export function DemoStorageFullMessage() {
  return (
    <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-danger-fg)] bg-[var(--color-danger-bg)] px-3.5 py-2.5 text-sm text-[var(--color-text)]">
      <HardDrive size={15} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-danger-fg)]" />
      <p>
        <strong className="font-[600]">Demo storage is full. Ask a Super Admin to reset demo data.</strong>{" "}
        <span className="text-[var(--color-text-2)]">Your latest changes are kept in this tab until you reload it.</span>
      </p>
    </div>
  );
}

/**
 * docs/03 §3.3: shown in every shell while the demo data can't be saved (browser storage full), so a
 * change is never lost silently. Disappears once a save succeeds again (e.g. after a reset).
 */
export function DemoStorageNotice() {
  return useDemoStorageFull() ? <DemoStorageFullMessage /> : null;
}
