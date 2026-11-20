"use client";

import { useMemo } from "react";
import type { Candidate } from "@/lib/schemas/candidate";
import type { ResumeShelf } from "@/lib/schemas/resume";
import { useTeam } from "@/lib/hooks/use-team";
import type { TreeLabels } from "./base-folder";

/**
 * What the résumé tree and the studio name things by (src/lib/derive/resume-name.ts): the candidates shown, a tailored
 * copy's job, and who saved a version. Missing ones fall back quietly. A tailored copy's job comes with the listing
 * (`targetJob`): no jobs are loaded to name it (Zuhair 2026-11-12: a candidate's screens read only that candidate's jobs).
 */
export function useTreeLabels(candidates: readonly Candidate[], shelf: ResumeShelf | undefined): TreeLabels {
  const teamQuery = useTeam();
  return useMemo(() => {
    const jobs = new Map((shelf?.resumes ?? []).flatMap((r) => (r.targetJobId && r.targetJob ? [[r.targetJobId, r.targetJob] as const] : [])));
    const people = new Map((teamQuery.data ?? []).map((u) => [u.id, u.name]));
    const byId = new Map(candidates.map((c) => [c.id, { name: c.fullName, role: c.primaryRole }]));
    return {
      job: (jobId: string) => jobs.get(jobId) ?? null,
      candidate: (candidateId: string) => byId.get(candidateId) ?? null,
      userName: (userId: string) => people.get(userId) ?? null,
    };
  }, [shelf, teamQuery.data, candidates]);
}
