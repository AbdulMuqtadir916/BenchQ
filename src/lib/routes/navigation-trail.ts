/**
 * The pages this load of BenchQ has shown, in order: one entry per pathname, kept in memory only. A full-screen view such
 * as the studio goes Back to the page it was opened from, but only when BenchQ showed one: a view opened directly (a new
 * tab, a link from the extension, a reload) has nothing of BenchQ's behind it, and Back would leave the app.
 * `window.history.length` can't tell the two apart, since it also counts the pages before BenchQ.
 */
const MAX_PAGES = 50;
const trail: string[] = [];

/** Called on every change of pathname (`NavigationTrail` in the root layout). */
export function recordPath(pathname: string): void {
  if (trail[trail.length - 1] === pathname) return;
  trail.push(pathname);
  if (trail.length > MAX_PAGES) trail.shift();
}

/** Whether BenchQ showed a page before the current run of pages that `isSameView` claims: the studio's tabs and
 * versions are one view, since they replace each other in the history. */
export function cameFromInsideApp(isSameView: (pathname: string) => boolean): boolean {
  let index = trail.length - 1;
  while (index >= 0 && isSameView(trail[index]!)) index -= 1;
  return index >= 0;
}

/** Tests start from an empty trail. */
export function forgetTrail(): void {
  trail.length = 0;
}
