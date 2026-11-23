"use client";

import { useDeferredValue } from "react";
import { useQuery } from "@tanstack/react-query";
import { candidatesApi } from "@/lib/api/candidates";
import { jobsApi } from "@/lib/api/jobs";
import { NO_FIRM, queryKeys } from "@/lib/query/keys";
import { useOptionalFirm } from "@/lib/tenancy/firm-context";

/** The jobs ⌘K shows for what is typed: the backend's search of every job the person sees (decided 2026-11-14). */
const PALETTE_JOBS = 20;

/**
 * The records ⌘K searches: the URL firm's candidates, on useCandidates()'s key so they share the cache, and the jobs
 * whose title, company or location holds what is typed (two characters or more), asked of the backend, which
 * searches all of them rather than a loaded few. The palette is part of the shell, which also renders on /dev, where
 * there is no firm: there it searches nothing and offers navigation only.
 */
export function usePaletteRecords(typed = "") {
  const firmId = useOptionalFirm()?.id ?? null;
  const key = firmId ?? NO_FIRM;
  const q = useDeferredValue(typed.trim());
  const candidates = useQuery({ queryKey: queryKeys.candidates.list(key), queryFn: () => candidatesApi.list(key), enabled: firmId !== null });
  const jobs = useQuery({
    queryKey: queryKeys.jobs.list(key, { q, limit: PALETTE_JOBS }),
    queryFn: () => jobsApi.list(key, { q, limit: PALETTE_JOBS }),
    enabled: firmId !== null && q.length >= 2,
  });
  return { candidates: candidates.data ?? [], jobs: q.length >= 2 ? (jobs.data ?? []) : [] };
}
