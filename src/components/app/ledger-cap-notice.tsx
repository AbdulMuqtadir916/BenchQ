/**
 * Shown above the Ledger table only when entries remain beyond what was loaded (BUG-022): the screen reads the whole ledger up to a
 * cap, and an audit trail must say so when it is not showing all of it.
 */
export function LedgerCapNotice({ hasMore, shown }: { hasMore: boolean; shown: number }) {
  if (!hasMore) return null;
  return (
    <p role="status" className="mb-3 text-caption text-[var(--color-text-3)]">
      {`Showing the latest ${shown.toLocaleString("en-US")} entries. Older entries are not loaded.`}
    </p>
  );
}
