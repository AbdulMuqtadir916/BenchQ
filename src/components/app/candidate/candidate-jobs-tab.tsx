"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Application } from "@/lib/schemas/application";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Job } from "@/lib/schemas/job";
import { EASE_OUT } from "@/lib/motion";
import { JobExplorer } from "@/components/app/jobs/job-explorer";
import { JobMatchIntro } from "@/components/app/jobs/job-match-intro";

interface CandidateJobsTabProps {
  candidate: Candidate;
  jobs: Job[];
  favoriteJobIds: string[];
  applications: Application[];
  isLoading: boolean;
  /** "Find jobs" was pressed and the matching sequence hasn't finished yet. */
  isMatching: boolean;
  /** Stagger the list in — true once a matching run has played. */
  hasMatched: boolean;
  onMatchDone: () => void;
}

/** The candidate's Jobs tab: optional matching sequence, then roles ranked for this profile. */
export function CandidateJobsTab({ candidate, jobs, favoriteJobIds, applications, isLoading, isMatching, hasMatched, onMatchDone }: CandidateJobsTabProps) {
  const reduce = useReducedMotion() ?? false;
  return (
    <AnimatePresence mode="wait" initial={false}>
      {isMatching ? (
        <motion.div
          key="matching"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, filter: "blur(6px)" }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
        >
          <JobMatchIntro candidate={candidate} jobs={jobs} applications={applications} isReady={!isLoading} onDone={onMatchDone} />
        </motion.div>
      ) : (
        <motion.div
          key="jobs"
          initial={reduce || !hasMatched ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT }}
        >
          <JobExplorer
            jobs={jobs}
            candidateFavoriteIds={favoriteJobIds}
            applications={applications}
            loading={isLoading}
            lockedCandidate={candidate}
            animateRows={hasMatched}
            toolbarBordered={false}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
