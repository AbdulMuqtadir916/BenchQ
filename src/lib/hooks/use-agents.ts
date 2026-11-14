"use client";

import { useMutation } from "@tanstack/react-query";
import { agentsApi } from "@/lib/api/agents";
import type { RewriteInput } from "@/lib/schemas/resume-document";

export function useRewrite() {
  return useMutation({
    mutationFn: (input: RewriteInput) => agentsApi.rewrite(input),
  });
}

