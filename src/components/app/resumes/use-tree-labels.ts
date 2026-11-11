"use client";

import { useMemo } from "react";
import type { Candidate } from "@/lib/schemas/candidate";
import { useJobs } from "@/lib/hooks/use-jobs";
import { useTeam } from "@/lib/hooks/use-team";
import type { TreeLabels } from "./base-folder";

/**
 * What the résumé tree and the studio name things by (src/lib/derive/resume-name.ts): the candidates shown, a tailored
 * copy's job, and who saved a version. Missing ones fall back quietly.
 */
export function useTreeLabels(candidates: readonly Candidate[]): TreeLabels {
  const jobsQuery = useJobs({ limit: 1000 });
  const teamQuery = useTeam();
  return useMemo(() => {
    const jobs = new Map((jobsQuery.data ?? []).map((j) => [j.id, { company: j.company.name, title: j.title }]));
    const people = new Map((teamQuery.data ?? []).map((u) => [u.id, u.name]));
    const byId = new Map(candidates.map((c) => [c.id, { name: c.fullName, role: c.primaryRole }]));
    return {
      job: (jobId: string) => jobs.get(jobId) ?? null,
      candidate: (candidateId: string) => byId.get(candidateId) ?? null,
      userName: (userId: string) => people.get(userId) ?? null,
    };
  }, [jobsQuery.data, teamQuery.data, candidates]);
}
