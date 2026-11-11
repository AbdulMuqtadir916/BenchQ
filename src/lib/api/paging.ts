export interface LoadedPages<T> {
  items: T[];
  /** More exist beyond the cap (always false when the whole list was read). */
  hasMore: boolean;
}

/**
 * Reads a list the backend serves in pages by cursor until it runs out, up to `maxItems` so that a huge list cannot freeze
 * the page (BUG-022: the Ledger read only the first 100 of 119 entries). A page shorter than asked for is the end; when the cap is
 * reached on a full page, one more row is probed to know whether the list really goes on. A failing page fails the whole read: a
 * partial list must never be shown as if it were complete.
 */
export async function loadAllPages<T>(
  fetchPage: (after: T | undefined, limit: number) => Promise<T[]>,
  { pageSize, maxItems }: { pageSize: number; maxItems: number },
): Promise<LoadedPages<T>> {
  const items: T[] = [];
  for (;;) {
    const want = Math.min(pageSize, maxItems - items.length);
    const page = await fetchPage(items.at(-1), want);
    items.push(...page);
    if (page.length < want) return { items, hasMore: false };
    if (items.length >= maxItems) return { items, hasMore: (await fetchPage(items.at(-1), 1)).length > 0 };
  }
}
