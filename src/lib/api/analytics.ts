import type { LedgerEntry } from "@/lib/schemas/analytics";
import { arrayOf } from "./client";
import { toBackendId } from "./dto/demo-ids";
import { LedgerEntryDto, toLedgerEntry } from "./dto/session";
import { http } from "./http";

/** backend/api/routes_ledger.py, (docs/integration/01-ledger.md). The backend scopes a BDE to their own entries. */
const live = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }) =>
    (await http.get(`/api/firms/${toBackendId(firmId)}/ledger`, arrayOf(LedgerEntryDto), { query: params })).map(toLedgerEntry),
};

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend serves only that firm's rows. */
export const ledgerApi = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }): Promise<LedgerEntry[]> =>
    live.list(firmId, params),
};
