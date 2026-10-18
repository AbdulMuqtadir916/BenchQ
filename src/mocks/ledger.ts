import { arrayOf } from "@/lib/api/client";
import { LedgerEntrySchema, type LedgerEntry } from "@/lib/schemas/analytics";
import ledgerSeed from "./data/ledger.json";
import { inDevFirm, mockResult } from "./_shared";

export const allLedger: LedgerEntry[] = arrayOf(LedgerEntrySchema).parse(ledgerSeed);
const ledger: LedgerEntry[] = inDevFirm(allLedger);

export const ledgerMock = {
  list: (params?: { limit?: number; offset?: number }): Promise<LedgerEntry[]> => {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    return mockResult(ledger.slice(offset, offset + limit));
  },
};
