import { ROLE_LABEL } from "@/lib/auth/roles";
import type { LedgerEntry } from "@/lib/schemas/analytics";

type ActorFields = Pick<LedgerEntry, "actorType" | "actorName" | "actorRole" | "onBehalfOfName" | "attemptCount">;

/** A person's row is their name and role. An AI agent's is the person it worked for, tagged; the system has only a tag. */
export function actorDisplay(entry: ActorFields): { name: string; role: string | null; hasTag: boolean } {
  const tries = entry.attemptCount && entry.attemptCount > 1 ? ` (${entry.attemptCount})` : "";
  return {
    name: `${entry.onBehalfOfName ?? entry.actorName}${tries}`,
    role: entry.actorRole ? ROLE_LABEL[entry.actorRole] : null,
    hasTag: entry.actorType === "AGENT" || entry.actorType === "SYSTEM",
  };
}
