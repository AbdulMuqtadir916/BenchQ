import type { LedgerEntry } from "@/lib/schemas/analytics";
import { arrayOf } from "./client";
import { toBackendId } from "./dto/demo-ids";
import { LedgerEntryDto, toLedgerEntry } from "./dto/session";
import { http } from "./http";

/**
 * Which entries to read (backend/api/routes_ledger.py): a page, and optionally one record's history
 * (`entityType` + `entityId`) or one kind of event (`action`, e.g. ASSIGN for "New assignments", 07 Q52).
 */
export type LedgerQuery = {
  limit?: number;
  offset?: number;
  entityType?: string;
  entityId?: string;
  action?: LedgerEntry["action"];
};

/**
 * backend/api/routes_ledger.py (docs/integration/01-ledger.md). The backend scopes a BDE to their own entries and the
 * ASSIGN entries about the candidates they work (07 Q52).
 */
const live = {
  list: async (firmId: string, params: LedgerQuery = {}) =>
    (await http.get(`/api/firms/${toBackendId(firmId)}/ledger`, arrayOf(LedgerEntryDto), {
      query: {
        limit: params.limit,
        offset: params.offset,
        entity_type: params.entityType,
        entity_id: params.entityId === undefined ? undefined : toBackendId(params.entityId),
        action: params.action,
      },
    })).map(toLedgerEntry),
};

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend serves only that firm's rows. */
export const ledgerApi = {
  list: async (firmId: string, params?: LedgerQuery): Promise<LedgerEntry[]> => live.list(firmId, params),
};
