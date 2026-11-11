import { z } from "zod";
import { ApiError } from "./client";
import type { Application } from "@/lib/schemas/application";
import type { StoredApplicationStatus } from "@/lib/schemas/enums";
import type { UpdateApplicationStatus } from "@/lib/schemas/inbox";
import { newCommandId } from "@/lib/utils";
import { http } from "./http";
import { isLive } from "./config";
import { toBackendId } from "./dto/demo-ids";
import { BackendApplicationListSchema, BackendApplicationSchema, toApplication, toApplications, toBackendStatus, toFrontendStatus } from "./dto/applications";

const mock = () => import("@/mocks/applications");
const PAGE = 500;

/** Counts per status, computed by the server over the same scope as the list (DEBUG D-20). */
export type ApplicationCounts = { total: number; byStatus: Partial<Record<StoredApplicationStatus, number>> };
const BackendCountsSchema = z.object({ total: z.number().int(), by_status: z.record(z.string(), z.number().int()) });

/** What saving a feed job sends (`POST /api/applications` with status saved). */
export type SaveJob = { candidateId: string; jobId: string; title: string; company: string; url: string };
const BackendSavedSchema = z.object({ id: z.string() });
const BackendUnsavedSchema = z.object({ favorite: z.literal(false) });

/** The backend takes the firm from the session, so the live calls need no firm in the path. */
const live = {
  /** Every page, in the server's stable order, so no board or counter is ever built from a truncated list. */
  list: async (firmId: string, params?: { candidateId?: string }): Promise<Application[]> => {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const query = { limit: PAGE, offset, ...(params?.candidateId ? { candidate_id: toBackendId(params.candidateId) } : {}) };
      const page = await http.get("/api/applications", BackendApplicationListSchema, { query });
      rows.push(...page.applications);
      if (page.applications.length < PAGE || rows.length >= page.total) break;
    }
    // Pages are read in the server's order; a row moved between pages mid-read must not appear twice.
    return toApplications([...new Map(rows.map((row) => [row.id, row])).values()], firmId);
  },

  byId: async (firmId: string, id: string): Promise<Application> => {
    const application = toApplication(await http.get(`/api/applications/${toBackendId(id)}`, BackendApplicationSchema), firmId);
    if (!application) throw new ApiError("Application not found.", "NOT_FOUND", 404);
    return application;
  },

  counts: async (_firmId: string, params?: { candidateId?: string }): Promise<ApplicationCounts> => {
    const query = params?.candidateId ? { candidate_id: toBackendId(params.candidateId) } : undefined;
    const dto = await http.get("/api/applications/counts", BackendCountsSchema, { query });
    const byStatus: ApplicationCounts["byStatus"] = {};
    for (const [status, count] of Object.entries(dto.by_status)) {
      const key = toFrontendStatus(status);
      byStatus[key] = (byStatus[key] ?? 0) + count;
    }
    return { total: dto.total, byStatus };
  },

  /** Compensating Undo of the latest automatic change; the server refuses it once a later decision exists. */
  undoAutomatic: async (firmId: string, id: string, eventId: string, expectedRevision: number, commandId: string): Promise<Application> => {
    const undone = toApplication(await http.post(`/api/applications/${toBackendId(id)}/status-events/${eventId}/undo`, BackendApplicationSchema, {
      body: { expected_revision: expectedRevision, command_id: commandId },
    }), firmId);
    if (!undone) throw new ApiError("Application not found.", "NOT_FOUND", 404);
    return undone;
  },

  /** Save a feed job for a candidate: the backend adds the favourite and a Saved draft (one per candidate and job). */
  saveJob: async (_firmId: string, body: SaveJob): Promise<string> => {
    const saved = await http.post("/api/applications", BackendSavedSchema, {
      body: { candidate_id: toBackendId(body.candidateId), job_id: toBackendId(body.jobId), status: "saved", title: body.title, company: body.company, url: body.url },
    });
    return saved.id;
  },

  /** Remove the favourite; the backend deletes the Saved draft only while nothing else has happened to it. */
  unsaveJob: async (_firmId: string, id: string): Promise<void> => {
    await http.patch(`/api/applications/${toBackendId(id)}`, BackendUnsavedSchema, { body: { unfavorite: true } });
  },

  /** PATCH candidate-status with the server-confirmed revision the caller read from the cache. */
  updateStatus: async (firmId: string, id: string, body: UpdateApplicationStatus): Promise<Application> => {
    if (body.expectedRevision === undefined) {
      throw new ApiError("Reload the application before changing its status.", "CONFLICT", 409);
    }
    const moved = toApplication(
      await http.patch(`/api/applications/${toBackendId(id)}/candidate-status`, BackendApplicationSchema, {
        body: { status: toBackendStatus(body.status), expected_revision: body.expectedRevision, note: body.note, command_id: newCommandId() },
      }),
      firmId,
    );
    if (!moved) throw new ApiError("Application not found.", "NOT_FOUND", 404);
    return moved;
  },
};

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const applicationsApi = {
  list: async (firmId: string, params?: { candidateId?: string }): Promise<Application[]> =>
    isLive("applications") ? live.list(firmId, params) : (await mock()).applicationsMock.list(firmId, params),

  byId: async (firmId: string, id: string): Promise<Application> =>
    isLive("applications") ? live.byId(firmId, id) : (await mock()).applicationsMock.byId(firmId, id),

  counts: async (firmId: string, params?: { candidateId?: string }): Promise<ApplicationCounts> => {
    if (isLive("applications")) return live.counts(firmId, params);
    const apps = await (await mock()).applicationsMock.list(firmId, params);
    const byStatus: ApplicationCounts["byStatus"] = {};
    for (const app of apps) byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;
    return { total: apps.length, byStatus };
  },

  updateStatus: async (firmId: string, id: string, body: UpdateApplicationStatus): Promise<Application> =>
    isLive("applications") ? live.updateStatus(firmId, id, body) : (await mock()).applicationsMock.updateStatus(firmId, id, body),

  saveJob: async (firmId: string, body: SaveJob): Promise<void> => {
    if (isLive("applications")) await live.saveJob(firmId, body);
    else await (await mock()).applicationsMock.saveJob(firmId, body);
  },

  unsaveJob: async (firmId: string, id: string): Promise<void> =>
    isLive("applications") ? live.unsaveJob(firmId, id) : (await mock()).applicationsMock.unsaveJob(firmId, id),

  /** Automatic changes exist only on the live backend; the mock has none to undo. */
  undoAutomatic: async (firmId: string, id: string, eventId: string, expectedRevision: number, commandId: string): Promise<Application> => {
    if (!isLive("applications")) throw new ApiError("Undo needs the live applications module.", "UNSUPPORTED", 400);
    return live.undoAutomatic(firmId, id, eventId, expectedRevision, commandId);
  },
};
