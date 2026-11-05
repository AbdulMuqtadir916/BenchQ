"use client";

import { useMemo } from "react";
import { useJobs } from "@/lib/hooks/use-jobs";
import { useTeam } from "@/lib/hooks/use-team";
import type { TreeLabels } from "./base-folder";

/** Row labels for the résumé tree: a tailored copy's job, and who saved a version. Missing ones fall back quietly. */
export function useTreeLabels(): TreeLabels {
  const jobsQuery = useJobs({ limit: 1000 });
  const teamQuery = useTeam();
  return useMemo(() => {
    const jobs = new Map((jobsQuery.data ?? []).map((j) => [j.id, `${j.title} · ${j.company.name}`]));
    const people = new Map((teamQuery.data ?? []).map((u) => [u.id, u.name]));
    return {
      jobLabel: (jobId: string) => jobs.get(jobId) ?? "A job",
      userName: (userId: string) => people.get(userId) ?? null,
    };
  }, [jobsQuery.data, teamQuery.data]);
}
