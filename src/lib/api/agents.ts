import type { RewriteInput, RewriteResult } from "@/lib/schemas/resume-document";

const mock = () => import("@/mocks/agents").then((m) => m.agentsMock);

export const agentsApi = {
  rewrite: async (input: RewriteInput, signal?: AbortSignal): Promise<RewriteResult> =>
    (await mock()).rewrite(input, signal),
};
