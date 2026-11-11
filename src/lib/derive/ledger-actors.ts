import type { LedgerEntry } from "@/lib/schemas/analytics";

type ActorType = LedgerEntry["actorType"];

/** The Ledger's actor filter (BUG-012): one entry per actor type, or All. */
export type ActorFilter = "ALL" | ActorType;

/**
 * Typed as a `Record` over the schema's actor types on purpose: adding an actor type to the schema stops compiling here until it has a
 * label, so the filter cannot silently lack one (it did: PLATFORM_ADMIN, the audit rows of a support view, had no option).
 */
export const ACTOR_LABEL: Record<ActorType, string> = {
  USER: "Users",
  PLATFORM_ADMIN: "Platform admins",
  AGENT: "AI agents",
  SYSTEM: "System",
};

/** In the order they are offered: All, then the people, then the machines. */
export const ACTOR_FILTERS: readonly ActorFilter[] = ["ALL", "USER", "PLATFORM_ADMIN", "AGENT", "SYSTEM"];

export function filterByActor(entries: readonly LedgerEntry[], filter: ActorFilter): LedgerEntry[] {
  return filter === "ALL" ? [...entries] : entries.filter((entry) => entry.actorType === filter);
}

/** How many entries each actor type has, zero where there are none (so an always-empty option shows as "(0)"). */
export function countByActor(entries: readonly LedgerEntry[]): Record<ActorType, number> {
  const counts: Record<ActorType, number> = { USER: 0, PLATFORM_ADMIN: 0, AGENT: 0, SYSTEM: 0 };
  for (const entry of entries) counts[entry.actorType]++;
  return counts;
}

/** "Platform admins (4)", and "All actors (100)" for the total. */
export function actorFilterLabel(filter: ActorFilter, counts: Record<ActorType, number>): string {
  if (filter === "ALL") return `All actors (${Object.values(counts).reduce((sum, n) => sum + n, 0)})`;
  return `${ACTOR_LABEL[filter]} (${counts[filter]})`;
}
