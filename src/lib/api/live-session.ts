import type { Session } from "@/lib/schemas/session";

/**
 * The live session as the session adapter last saw it, for the modules still on mocks: they read the
 * signed-in principal synchronously (src/mocks/auth.ts), the way a server reads its cookie. Only
 * src/lib/api/session.ts and src/lib/api/invites.ts write it. Temporary, like src/lib/api/config.ts: it goes
 * when the last mocked module is live.
 */
let current: Session | null = null;

export function liveSession(): Session | null {
  return current;
}

/** Remember the session, and tell the other tabs it changed (Q27): they ask `current()` again. */
export function rememberLiveSession(session: Session | null, { broadcast = true } = {}): void {
  const changed = JSON.stringify(current?.principal ?? null) !== JSON.stringify(session?.principal ?? null);
  current = session;
  if (broadcast && changed) channel()?.postMessage("changed");
}

const CHANNEL = "benchq.session";

/** One channel per tab: a BroadcastChannel never hears its own messages, so a tab isn't told of its own change. */
let tabChannel: BroadcastChannel | null = null;

function channel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  tabChannel ??= new BroadcastChannel(CHANNEL);
  return tabChannel;
}

/** Call `onChange` when another tab signs in, out or as someone else. Returns the unsubscribe. */
export function watchLiveSession(onChange: () => void): () => void {
  const tab = channel();
  if (!tab) return () => {};
  const listener = () => onChange();
  tab.addEventListener("message", listener);
  return () => tab.removeEventListener("message", listener);
}
