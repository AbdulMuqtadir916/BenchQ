import { arrayOf } from "@/lib/api/client";
import { LedgerEntrySchema, type LedgerEntry } from "@/lib/schemas/analytics";
import ledgerSeed from "./data/ledger.json";
import { inFirm, mockResult } from "./_shared";
import { seededAt, table } from "./db";
import { firmScoped } from "./membership";
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
  /** A firm's ledger: its own events only. Platform-only events (firmId null) belong to /admin/audit (Phase P). */
  list: (firmId: string, params?: { limit?: number; offset?: number }): Promise<LedgerEntry[]> => {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    return mockResult(inFirm(allLedger, firmId).slice(offset, offset + limit));
  },
});
