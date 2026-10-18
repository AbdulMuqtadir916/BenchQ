import type { Application, FollowUpTask } from "@/lib/schemas/application";
import type { UpdateApplicationStatus } from "@/lib/schemas/inbox";

const mock = () => import("@/mocks/applications");

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const applicationsApi = {
  list: async (firmId: string, params?: { candidateId?: string }): Promise<Application[]> =>
    (await mock()).applicationsMock.list(firmId, params),

  byId: async (firmId: string, id: string): Promise<Application> => (await mock()).applicationsMock.byId(firmId, id),

  updateStatus: async (firmId: string, id: string, body: UpdateApplicationStatus): Promise<Application> =>
    (await mock()).applicationsMock.updateStatus(firmId, id, body),
};

export const followupsApi = {
  list: async (firmId: string, params?: { userId?: string }): Promise<FollowUpTask[]> => (await mock()).followupsMock.list(firmId, params),
};
