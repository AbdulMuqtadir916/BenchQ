import { arrayOf } from "@/lib/api/client";
import { LedgerEntrySchema, type LedgerEntry } from "@/lib/schemas/analytics";
import ledgerSeed from "./data/ledger.json";
import { inFirm, mockResult } from "./_shared";
import { table } from "./db";
import { firmScoped } from "./membership";

/** Persisted (src/mocks/db.ts); writers call `changed("ledger")`. */
export const allLedger: LedgerEntry[] = table("ledger", LedgerEntrySchema, () => arrayOf(LedgerEntrySchema).parse(ledgerSeed));

export const ledgerMock = firmScoped("ledger", {
  /** A firm's ledger: its own events only. Platform-only events (firmId null) belong to /admin/audit (Phase P). */
  list: (firmId: string, params?: { limit?: number; offset?: number }): Promise<LedgerEntry[]> => {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    return mockResult(inFirm(allLedger, firmId).slice(offset, offset + limit));
  },
});
