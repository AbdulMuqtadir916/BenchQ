import type { Job } from "@/lib/schemas/job";

const mock = () => import("@/mocks/jobs").then((m) => m.jobsMock);

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const jobsApi = {
  list: async (firmId: string, params?: { limit?: number; offset?: number }): Promise<Job[]> => (await mock()).list(firmId, params),

  byId: async (firmId: string, id: string): Promise<Job> => (await mock()).byId(firmId, id),
};
