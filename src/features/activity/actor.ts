import { ROLE_LABEL } from "@/lib/auth/roles";
import type { LedgerEntry } from "@/lib/schemas/analytics";

type ActorFields = Pick<LedgerEntry, "actorType" | "actorName" | "actorRole" | "onBehalfOfName">;

/** A person's row is their name and role. An AI agent's is the person it worked for, tagged; the system has only a tag. */
export function actorDisplay(entry: ActorFields): { name: string; role: string | null; hasTag: boolean } {
  return {
    name: entry.onBehalfOfName ?? entry.actorName,
    role: entry.actorRole ? ROLE_LABEL[entry.actorRole] : null,
    hasTag: entry.actorType === "AGENT" || entry.actorType === "SYSTEM",
  };
}
