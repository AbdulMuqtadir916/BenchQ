"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { resumesApi } from "@/lib/api/resumes";
import type { AutofillChange } from "@/lib/schemas/resume-autofill";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

/** One version's autofill, for the Autofill screen (docs/02 §8.3). */
export function useResumeAutofill(versionId: string) {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.resumes.autofill(firmId, versionId),
    queryFn: () => resumesApi.autofill(firmId, versionId),
    enabled: !!versionId,
  });
}

/** Saves a change to the version's autofill. Its answer is the version's list; other versions it reached read again. */
export function useSaveResumeAutofill(versionId: string) {
  const firmId = useFirmId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ candidateId, change }: { candidateId: string; change: AutofillChange }) =>
      resumesApi.saveAutofill(firmId, candidateId, versionId, change),
    onSuccess: ({ autofill, changed }) => {
      queryClient.setQueryData(queryKeys.resumes.autofill(firmId, versionId), autofill);
      if (changed > 1) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.resumes.autofillAll(firmId),
          predicate: ({ queryKey }) => queryKey[3] !== versionId,
        });
      }
    },
  });
}
