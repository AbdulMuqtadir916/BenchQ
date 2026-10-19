import { arrayOf } from "@/lib/api/client";
import { LedgerEntrySchema, type LedgerEntry } from "@/lib/schemas/analytics";
import ledgerSeed from "./data/ledger.json";
import { inFirm, mockResult, newId } from "./_shared";
import { changed, seededAt, table } from "./db";
import { firmScoped } from "./membership";
import { currentPrincipal, currentUser } from "./auth";
import { scopeLedger } from "@/lib/auth/policy";
import { shiftFixtureDate } from "./tenancy";

/**
 * The ledger fixtures at a given "now". Entries about invites move with their invites (src/mocks/tenancy.ts,
 * `invitesAt`), so an INVITE_SENT is dated when its invite was created and an INVITE_ACCEPTED within the
 * invite's life (docs/07 P3); every other entry keeps its fixed date.
 */
export function ledgerAt(now: Date): LedgerEntry[] {
  return arrayOf(LedgerEntrySchema)
    .parse(ledgerSeed)
    .map((entry) => (entry.entityType === "invite" ? { ...entry, createdAt: shiftFixtureDate(entry.createdAt, now) } : entry));
}

/** Persisted (src/mocks/db.ts); writers call `changed("ledger")`. Seeded relative to `seededAt`, like the invites. */
export const allLedger: LedgerEntry[] = table("ledger", LedgerEntrySchema, () => ledgerAt(seededAt()));

export const ledgerMock = firmScoped("ledger", {
  /**
   * A firm's ledger: its own events only (platform-only events, firmId null, are /admin/audit's), in the
   * principal's scope (07 §2.2): a BDE gets only the entries they made, before paging.
   */
  list: (firmId: string, params?: { limit?: number; offset?: number }): Promise<LedgerEntry[]> => {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    return mockResult(scopeLedger(currentPrincipal(), inFirm(allLedger, firmId)).slice(offset, offset + limit));
  },
});

/**
 * A firm user's action, in their firm's ledger (actor = the signed-in user). Writers call it after the
 * write itself; it marks the ledger changed.
 */
export function logFirmAction(entry: Pick<LedgerEntry, "firmId" | "entityType" | "entityId" | "entityLabel" | "action" | "summary">, now = new Date()): void {
  const user = currentUser();
  allLedger.unshift({
    id: newId("ledger", now),
    actorUserId: user.id,
    actorType: "USER",
    actorName: user.name,
    modelId: null,
    promptVersion: null,
    evidenceIds: [],
    claimState: null,
    createdAt: now.toISOString(),
    ...entry,
  });
  changed("ledger");
}
