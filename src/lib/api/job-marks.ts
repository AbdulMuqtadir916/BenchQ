import type { JobMark, JobMarkKind } from "@/lib/schemas/job";

const mock = () => import("@/mocks/job-marks").then((m) => m.jobMarksMock);

/** A person's saved / hidden jobs (docs/02 §6.x). Firm-scoped; the server answers with the signed-in user's own. */
export const jobMarksApi = {
  list: async (firmId: string): Promise<JobMark[]> => (await mock()).list(firmId),

  mark: async (firmId: string, jobId: string, kind: JobMarkKind): Promise<JobMark> => (await mock()).mark(firmId, jobId, kind),

  unmark: async (firmId: string, jobId: string, kind: JobMarkKind): Promise<void> => (await mock()).unmark(firmId, jobId, kind),
};
