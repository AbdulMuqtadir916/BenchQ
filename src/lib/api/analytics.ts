import type { LedgerEntry } from "@/lib/schemas/analytics";
import { arrayOf } from "./client";
import { isLive } from "./config";
import { toBackendId } from "./dto/demo-ids";
import { LedgerEntryDto, toLedgerEntry } from "./dto/session";
import { http } from "./http";

const mock = () => import("@/mocks/ledger").then((m) => m.ledgerMock);

/** backend/api/routes_ledger.py, behind the `ledger` switch (docs/integration/01-ledger.md). The backend scopes a BDE to their own entries. */
const live = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }) =>
    (await http.get(`/api/firms/${toBackendId(firmId)}/ledger`, arrayOf(LedgerEntryDto), { query: params })).map(toLedgerEntry),
};

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const ledgerApi = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }): Promise<LedgerEntry[]> =>
    isLive("ledger") ? live.list(firmId, params) : (await mock()).list(firmId, params),
};
