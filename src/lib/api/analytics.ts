import type { LedgerEntry } from "@/lib/schemas/analytics";

const mock = () => import("@/mocks/ledger").then((m) => m.ledgerMock);

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const ledgerApi = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }): Promise<LedgerEntry[]> => (await mock()).list(firmId, params),
};
