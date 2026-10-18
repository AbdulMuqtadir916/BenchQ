"use client";

import { useMutation } from "@tanstack/react-query";
import { agentsApi } from "@/lib/api/agents";
import type { TailorResumeInput } from "@/lib/schemas/agent";
import type { RewriteInput } from "@/lib/schemas/resume-document";
import { useFirmId } from "@/lib/stores/session-store";

export function useRewrite() {
  return useMutation({
    mutationFn: (input: RewriteInput) => agentsApi.rewrite(input),
  });
}

export function useTailorResume() {
  const firmId = useFirmId();
  return useMutation({
    mutationFn: ({ input, signal }: { input: TailorResumeInput; signal?: AbortSignal }) =>
      agentsApi.tailorResume(firmId, input, signal),
  });
}
