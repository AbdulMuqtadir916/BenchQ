"use client";

import { useQuery } from "@tanstack/react-query";
import { candidatesApi } from "@/lib/api/candidates";
import { jobsApi } from "@/lib/api/jobs";
import { NO_FIRM, queryKeys } from "@/lib/query/keys";
import { useOptionalFirm } from "@/lib/tenancy/firm-context";

/**
 * The records ⌘K searches: the URL firm's candidates and jobs, on the same keys as useCandidates() /
 * useJobs() so they share the cache. The palette is part of the shell, which also renders on /dev,
 * where there is no firm: there it searches nothing and offers navigation only.
 */
export function usePaletteRecords() {
  const firmId = useOptionalFirm()?.id ?? null;
  const key = firmId ?? NO_FIRM;
  const candidates = useQuery({ queryKey: queryKeys.candidates.list(key), queryFn: () => candidatesApi.list(key), enabled: firmId !== null });
  const jobs = useQuery({ queryKey: queryKeys.jobs.list(key), queryFn: () => jobsApi.list(key), enabled: firmId !== null });
  return { candidates: candidates.data ?? [], jobs: jobs.data ?? [] };
}
