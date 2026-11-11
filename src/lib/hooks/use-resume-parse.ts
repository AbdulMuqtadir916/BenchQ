"use client";

import { useMutation } from "@tanstack/react-query";
import { resumeParseApi } from "@/lib/api/resume-parse";
import { useFirmId } from "@/lib/tenancy/firm-context";

/** Read a résumé into a draft for the new-candidate form (nothing is saved, 07 Q49). */
export function useParseResume() {
  const firmId = useFirmId();
  return useMutation({ mutationFn: (file: File) => resumeParseApi.parse(firmId, file) });
}
