import { z } from "zod";
import type { LedgerCandidate, LedgerEntry, LedgerPeople } from "@/lib/schemas/analytics";
import { arrayOf } from "./client";
import { toBackendId } from "./dto/demo-ids";
import { LedgerCandidateDto, LedgerPeopleDto, toLedgerCandidate, toLedgerPeople } from "./dto/ledger";
import { LedgerEntryDto, toLedgerEntry } from "./dto/session";
import { http } from "./http";
import { loadAllPages, type LoadedPages } from "./paging";

/**
 * Which entries to read (backend/api/routes_ledger.py): a page, and optionally one record's history
 * (`entityType` + `entityId`) or one kind of event (`action`, e.g. ASSIGN for "New assignments", 07 Q52).
 */
export type LedgerQuery = LedgerFilters & { limit?: number; offset?: number; sort?: "when" | "actor" | "action"; dir?: "asc" | "desc" };

/** What every read of the log narrows by. Dates are days in the firm's own time zone, YYYY-MM-DD. */
export type LedgerFilters = {
  entityType?: string;
  entityId?: string;
  action?: LedgerEntry["action"];
  candidateId?: string;
  /** One person, including what their AI agents did for them. */
  actorId?: string;
  /** One manager's team, as it was when each row was written. */
  teamId?: string;
  actorType?: LedgerEntry["actorType"];
  fromDate?: string;
  toDate?: string;
  q?: string;
};

const backendId = (value: string | undefined) => (value === undefined ? undefined : toBackendId(value));

const filterQuery = (filters: LedgerFilters) => ({
  entity_type: filters.entityType,
  entity_id: backendId(filters.entityId),
  action: filters.action,
  candidate_id: backendId(filters.candidateId),
  actor_id: backendId(filters.actorId),
  team_id: backendId(filters.teamId),
  actor_type: filters.actorType,
  from_date: filters.fromDate,
  to_date: filters.toDate,
  q: filters.q,
});

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
        sort: params.sort,
        dir: params.dir,
        ...filterQuery(params),
      },
    })).map(toLedgerEntry),
  people: async (firmId: string, filters: LedgerFilters = {}) =>
    toLedgerPeople(await http.get(`/api/firms/${toBackendId(firmId)}/ledger/people`, LedgerPeopleDto, { query: filterQuery(filters) })),
  candidates: async (firmId: string, filters: LedgerFilters = {}) =>
    (await http.get(`/api/firms/${toBackendId(firmId)}/ledger/candidates`, arrayOf(LedgerCandidateDto), { query: filterQuery(filters) })).map(toLedgerCandidate),
  days: (firmId: string, filters: LedgerFilters = {}) =>
    http.get(`/api/firms/${toBackendId(firmId)}/ledger/days`, z.array(z.string()), { query: filterQuery(filters) }),
};

/** Use the wire timestamp and ID so the cursor retains precision and backend UUIDs. */
type LedgerWire = Parameters<typeof toLedgerEntry>[0];

function readLedger(firmId: string, params: LedgerQuery = {}, after?: LedgerWire) {
  return http.get(`/api/firms/${toBackendId(firmId)}/ledger`, arrayOf(LedgerEntryDto), {
    query: {
      limit: params.limit,
      offset: params.offset,
      cursor_at: after?.created_at,
      cursor_id: after?.id,
      entity_type: params.entityType,
      entity_id: params.entityId === undefined ? undefined : toBackendId(params.entityId),
      action: params.action,
    },
  });
}

/** The backend serves 500 at most per request; a screen that shows the whole ledger stops at this many entries (and says so). */
const LEDGER_PAGE_SIZE = 500;
export const LEDGER_MAX_ENTRIES = 2000;

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend serves only that firm's rows. */
export const ledgerApi = {
  list: async (firmId: string, params?: LedgerQuery): Promise<LedgerEntry[]> => live.list(firmId, params),
  people: async (firmId: string, filters?: LedgerFilters): Promise<LedgerPeople> => live.people(firmId, filters),
  candidates: async (firmId: string, filters?: LedgerFilters): Promise<LedgerCandidate[]> => live.candidates(firmId, filters),
  days: async (firmId: string, filters?: LedgerFilters): Promise<string[]> => live.days(firmId, filters),
  /**
   * The whole ledger for a screen that shows all of it (BUG-022), newest first: page after page until it runs out, up to
   * `LEDGER_MAX_ENTRIES`, with `hasMore` true when entries remain beyond that. `limit` and `offset` in `params` are ignored.
   */
  listAll: async (firmId: string, params?: Omit<LedgerQuery, "limit" | "offset">): Promise<LoadedPages<LedgerEntry>> =>
    loadAllPages<LedgerWire>((after, limit) => readLedger(firmId, { ...params, limit }, after), { pageSize: LEDGER_PAGE_SIZE, maxItems: LEDGER_MAX_ENTRIES })
      .then(({ items, hasMore }) => ({ items: items.map(toLedgerEntry), hasMore })),
};
