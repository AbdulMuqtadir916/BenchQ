import type { AgentDraft, TailorResumeInput } from "@/lib/schemas/agent";
import type { RewriteInput, RewriteResult } from "@/lib/schemas/resume-document";

const mock = () => import("@/mocks/agents").then((m) => m.agentsMock);

export const agentsApi = {
  rewrite: async (input: RewriteInput, signal?: AbortSignal): Promise<RewriteResult> =>
    (await mock()).rewrite(input, signal),

  /** Agent runs are firm-scoped (A17): the run is recorded against the firm. */
  tailorResume: async (firmId: string, input: TailorResumeInput, signal?: AbortSignal): Promise<AgentDraft> =>
    (await mock()).tailorResume(firmId, input, signal),
};
