import type { Application, FollowUpTask } from "@/lib/schemas/application";
import type { ApplicationStatus } from "@/lib/schemas/enums";
import type { UpdateApplicationStatus } from "@/lib/schemas/inbox";
import { BackendApplicationListSchema, BackendApplicationSchema, toApplication } from "./dto/applications";
import { http } from "./http";
import { toBackendId } from "./dto/demo-ids";

const mock = () => import("@/mocks/followups");

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
async function listApplications(firmId: string, candidateId?: string): Promise<Application[]> {
  const result: Application[] = [];
  let offset = 0;
  while (true) {
    const response = await http.get("/api/applications", BackendApplicationListSchema, {
      query: { tracked_only: true, candidate_id: candidateId ? toBackendId(candidateId) : undefined, limit: 200, offset },
    });
    for (const application of response.applications) {
      if (!application.candidate_id) throw new Error("Tracked application has no candidate.");
      result.push(toApplication(application, firmId, application.candidate_id));
    }
    offset += response.applications.length;
    if (offset >= response.total) return result;
    if (!response.applications.length) throw new Error("Application pagination stopped before all records were received.");
  }
}

export const applicationsApi = {
  list: (firmId: string, params?: { candidateId?: string }): Promise<Application[]> => listApplications(firmId, params?.candidateId),
  listForCandidate: (firmId: string, candidateId: string): Promise<Application[]> => listApplications(firmId, candidateId),

  byId: async (firmId: string, id: string): Promise<Application> => {
    const response = await http.get("/api/applications/" + toBackendId(id), BackendApplicationSchema);
    if (!response.candidate_id) throw new Error("Tracked application has no candidate.");
    return toApplication(response, firmId, response.candidate_id);
  },

  moveCandidateStatus: async (firmId: string, candidateId: string, id: string, status: ApplicationStatus,
                              expectedRevision: number, commandId: string, note: string | null = null): Promise<Application> => {
    const response = await http.patch("/api/applications/" + toBackendId(id) + "/candidate-status", BackendApplicationSchema, {
      body: { status: status.toLowerCase(), expected_revision: expectedRevision, command_id: commandId, note },
    });
    return toApplication(response, firmId, candidateId);
  },

  updateStatus: async (firmId: string, id: string, body: UpdateApplicationStatus,
                      expectedRevision: number, commandId: string): Promise<Application> => {
    const response = await http.patch("/api/applications/" + toBackendId(id) + "/candidate-status", BackendApplicationSchema, {
      body: { status: body.status.toLowerCase(), note: body.note, expected_revision: expectedRevision, command_id: commandId },
    });
    if (!response.candidate_id) throw new Error("Tracked application has no candidate.");
    return toApplication(response, firmId, response.candidate_id);
  },
};

export const followupsApi = {
  list: async (firmId: string, params?: { userId?: string }): Promise<FollowUpTask[]> => (await mock()).followupsMock.list(firmId, params),
};
