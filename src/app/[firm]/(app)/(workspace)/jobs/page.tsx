"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useJobs } from "@/lib/hooks/use-jobs";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useApplications } from "@/lib/hooks/use-applications";
import { useSignedInUser } from "@/lib/stores/session-store";
import { EASE_OUT } from "@/lib/motion";
import { PageHeader } from "@/components/app/page-header";
import { ErrorState } from "@/components/app/error-state";
import { JobExplorer } from "@/components/app/jobs/job-explorer";
import { JobMatchIntro } from "@/components/app/jobs/job-match-intro";
import { JobCaptureDialogTrigger } from "@/components/app/jobs/job-capture-form";
import { useHref } from "@/lib/routes/use-href";

function JobsContent() {
  const toHref = useHref();
  const user = useSignedInUser();
  const focusId = useSearchParams().get("candidate");
  const reduce = useReducedMotion() ?? false;
  const jobsQuery = useJobs({ limit: 400 });
  const candidatesQuery = useCandidates();
  const applicationsQuery = useApplications();
  const [introDoneFor, setIntroDoneFor] = useState<string | null>(null);
  const finishIntro = useCallback(() => setIntroDoneFor(focusId), [focusId]);

  const candidates = useMemo(() => candidatesQuery.data ?? [], [candidatesQuery.data]);
  const focus = focusId ? (candidates.find((c) => c.id === focusId) ?? null) : null;
  const myCandidates = useMemo(() => {
    const mine = user.role === "BDE" ? candidates.filter((c) => c.assignedUserIds.includes(user.id)) : candidates;
    return focus && !mine.some((c) => c.id === focus.id) ? [focus, ...mine] : mine;
  }, [candidates, user, focus]);

  const isLoading = jobsQuery.isLoading || candidatesQuery.isLoading || applicationsQuery.isLoading;
  const error = jobsQuery.error ?? candidatesQuery.error ?? applicationsQuery.error;
  // Play the matching sequence once per "Find jobs" hand-off; skip it if the candidate doesn't exist.
  const showIntro = !!focusId && introDoneFor !== focusId && !error && (isLoading || focus !== null);

  return (
    <div className="bq-page bq-page-wide">
      {focus ? (
        <Link href={toHref("candidates.detail", { id: focus.id })} className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-3)] hover:text-[var(--color-text)]">
          <ArrowLeft size={14} aria-hidden /> {focus.fullName}
        </Link>
      ) : null}
      <PageHeader
        title="Jobs"
        subtitle={focus ? `Open roles ranked for ${focus.fullName} — best match first.` : "Search, score, and inspect every role without leaving the queue."}
        actions={
          user.role !== "VIEWER" ? (
            <JobCaptureDialogTrigger />
          ) : undefined
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={() => { void jobsQuery.refetch(); void candidatesQuery.refetch(); void applicationsQuery.refetch(); }} />
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {showIntro ? (
            <motion.div
              key="intro"
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, filter: "blur(6px)" }}
              transition={{ duration: 0.28, ease: EASE_OUT }}
              className="pt-4"
            >
              <JobMatchIntro candidate={focus} jobs={jobsQuery.data ?? []} applications={applicationsQuery.data ?? []} isReady={!isLoading} onDone={finishIntro} />
            </motion.div>
          ) : (
            <motion.div
              key={`explorer-${focusId ?? "all"}`}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: EASE_OUT }}
            >
              <JobExplorer
                jobs={jobsQuery.data ?? []}
                candidates={myCandidates}
                applications={applicationsQuery.data ?? []}
                loading={isLoading}
                initialCandidateId={focus?.id}
                animateRows={!!focus}
                toolbarBordered={false}
              />
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense>
      <JobsContent />
    </Suspense>
  );
}
