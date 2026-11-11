/**
 * The table's 0-based page index for a 1-based `?page=` value (CLAUDE.md: pagination lives in the URL). The number is kept
 * inside the pages that exist, so a stale or hand-typed one lands on the last page, never on an empty one. With no rows yet
 * (still loading, or filtered to nothing) the index is 0 and the number in the URL is left alone until rows arrive.
 */
export function pageIndexFor(page: number, rowCount: number, pageSize: number): number {
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  return Math.min(Math.max(1, page), pageCount) - 1;
}
