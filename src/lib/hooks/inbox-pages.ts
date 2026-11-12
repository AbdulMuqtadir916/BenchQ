import type { InfiniteData } from "@tanstack/react-query";
import type { CandidateInbox } from "@/lib/schemas/inbox";

export type InboxPages = InfiniteData<CandidateInbox, string | null>;
export const MAX_RESTORE_PAGES = 3;
const CLASSIFYING = new Set(["PENDING", "PROCESSING"]);
type RefreshCycle = {signal: AbortSignal; cycles: WeakMap<AbortSignal, boolean>};

/** Refresh the head without replaying all cached history. If more than one
 * page arrived, bridge to the previous head before keeping its stable cursor;
 * otherwise those arrivals would be skipped by the next Load more. */
export async function loadInboxPage(
  cursor: string | null,
  cached: InboxPages | undefined,
  fetchPage: (cursor: string | null) => Promise<CandidateInbox>,
  refresh?: RefreshCycle,
): Promise<CandidateInbox> {
  const index = cached?.pageParams.indexOf(cursor) ?? -1;
  if (cursor !== null && index >= 0 && !refresh?.cycles.get(refresh.signal)) return cached!.pages[index];
  const head = await fetchPage(cursor);
  const previous = cached?.pages[0];
  if (cursor !== null || !previous || cached!.pages.length < 2 || previous.messages.length === 0) return head;

  const known = new Set(previous.messages.map(message => message.id));
  const countDelta = head.totalCount !== undefined && previous.totalCount !== undefined
    ? head.totalCount - previous.totalCount : null;
  if (countDelta !== null && countDelta < 0) {
    refresh?.cycles.set(refresh.signal, true);
    return head;
  }
  const fresh = [...head.messages];
  let page = head;
  const visited = new Set<string>();
  while (page.nextCursor && !page.messages.some(message => known.has(message.id))) {
    if (visited.has(page.nextCursor)) throw new Error("Inbox pagination did not advance. Please retry.");
    visited.add(page.nextCursor);
    page = await fetchPage(page.nextCursor);
    fresh.push(...page.messages);
  }
  const newlySeen = new Set(fresh.filter(message => !known.has(message.id)).map(message => message.id));
  if (countDelta !== null && countDelta !== newlySeen.size) {
    // Import can backfill old dates, and other users can erase history. Refresh
    // loaded pages once when counts indicate a change outside the newest mail;
    // ordinary same-count/newest-only polling still reuses history.
    refresh?.cycles.set(refresh.signal, true);
    return head;
  }
  // Mail still being classified outside the fresh head would keep its stale state, and polling would never stop:
  // refresh every loaded page once instead, so finished classifications replace the cached ones.
  const freshIds = new Set(fresh.map(message => message.id));
  if (cached!.pages.some(cachedPage => cachedPage.messages.some(message =>
    !freshIds.has(message.id) && CLASSIFYING.has(message.classificationState ?? "")))) {
    refresh?.cycles.set(refresh.signal, true);
    return head;
  }
  const seen = new Set<string>();
  return {...head, nextCursor: previous.nextCursor,
    messages: [...fresh, ...previous.messages].filter(message => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    })};
}
