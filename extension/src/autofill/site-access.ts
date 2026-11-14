import { hostOf } from "./job-check";

/** A site BenchQ isn't allowed to read yet: the address Chrome is asked about, and the name to show. */
export interface SiteAccess {
  origins: string[];
  host: string;
}

const MAIN_FRAME = 0;

/** The tab's page address. Chrome hides a tab's `url` on a site BenchQ can't read yet; its navigation still says it. */
export async function pageUrlOf(tabId: number): Promise<string> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  return frames?.find((frame) => frame.frameId === MAIN_FRAME)?.url ?? "";
}

/** The tab's own site, when it's an https one BenchQ can't read yet. Sites on BenchQ's built-in list (the job boards and
 * application systems) are already allowed, so for them this is null and nothing changes. Only the page itself is
 * asked about: the ads, analytics and widgets framed inside it are none of BenchQ's business. */
export async function missingAccess(tabId: number): Promise<SiteAccess | null> {
  const url = await pageUrlOf(tabId);
  if (!url.startsWith("https://")) return null;
  const origin = `${new URL(url).origin}/*`;
  if (await chrome.permissions.contains({ origins: [origin] })) return null;
  return { origins: [origin], host: hostOf(url) };
}

/** Asks Chrome, which shows its own prompt. It only does so from a click, so call this first thing in the click's handler. */
export const requestAccess = ({ origins }: SiteAccess): Promise<boolean> => chrome.permissions.request({ origins });
