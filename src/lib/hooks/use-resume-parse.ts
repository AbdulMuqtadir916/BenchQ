"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { resumeParseApi } from "@/lib/api/resume-parse";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

/** Read a résumé into a draft for the new-candidate form (nothing is saved, 07 Q49). */
export function useParseResume() {
  const firmId = useFirmId();
  return useMutation({ mutationFn: (file: File) => resumeParseApi.parse(firmId, file) });
}

/** The sample résumés step 1 offers; none when the parser is live. */
export function useSampleResumes() {
  return useQuery({ queryKey: queryKeys.resumeSamples(), queryFn: () => resumeParseApi.sampleNames(), staleTime: Infinity });
}
