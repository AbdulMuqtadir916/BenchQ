import { z } from "zod";
import type { StartTailoring, TailoringRun } from "@/lib/schemas/tailoring";
import { toBackendId } from "./dto/demo-ids";
import { TailoringRunDto, toStartBody, toTailoringRun } from "./dto/tailoring";
import { http } from "./http";

/** backend/api/routes_resume_tailoring.py (docs/02 §8.3). Tailoring runs only on the backend: there is no mock. */
const firmPath = (firmId: string) => `/api/firms/${toBackendId(firmId)}`;

export const tailoringApi = {
  /** Start one (the candidate's BDE only); it runs in the background for about a minute. Its run id. */
  start: async (firmId: string, input: StartTailoring): Promise<string> =>
    (await http.post(`${firmPath(firmId)}/candidates/${toBackendId(input.candidateId)}/resumes/tailor`,
      z.object({ run_id: z.string() }), { body: toStartBody(input) })).run_id,

  /** The signed-in user's own tailorings: running, or finished in the last 30 minutes (their panel). */
  mine: async (firmId: string): Promise<TailoringRun[]> =>
    (await http.get(`${firmPath(firmId)}/tailorings`, z.array(TailoringRunDto))).map(toTailoringRun),
};
