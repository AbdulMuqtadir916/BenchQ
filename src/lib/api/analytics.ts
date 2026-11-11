import type { LedgerEntry } from "@/lib/schemas/analytics";
import { arrayOf } from "./client";
import { toBackendId } from "./dto/demo-ids";
import { LedgerEntryDto, toLedgerEntry } from "./dto/session";
import { http } from "./http";
import { loadAllPages, type LoadedPages } from "./paging";

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

/** The backend serves 500 at most per request; a screen that shows the whole ledger stops at this many entries (and says so). */
const LEDGER_PAGE_SIZE = 500;
export const LEDGER_MAX_ENTRIES = 2000;

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend serves only that firm's rows. */
export const ledgerApi = {
  list: async (firmId: string, params?: LedgerQuery): Promise<LedgerEntry[]> => live.list(firmId, params),
  /**
   * The whole ledger for a screen that shows all of it (BUG-022), newest first: page after page until it runs out, up to
   * `LEDGER_MAX_ENTRIES`, with `hasMore` true when entries remain beyond that. `limit` and `offset` in `params` are ignored.
   */
  listAll: async (firmId: string, params?: Omit<LedgerQuery, "limit" | "offset">): Promise<LoadedPages<LedgerEntry>> =>
    loadAllPages((offset, limit) => live.list(firmId, { ...params, limit, offset }), { pageSize: LEDGER_PAGE_SIZE, maxItems: LEDGER_MAX_ENTRIES }),
};
