import { useCallback, useEffect, useRef, useState } from "react";
import { getCandidateJob, isSessionExpired, type BenchqJob } from "../api";

/** The connected job's posting in BenchQ, as its details page shows it. `none`: there's nothing to ask about yet (the
 * page isn't open, or BenchQ hasn't confirmed the job). */
export type Posting =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; posting: BenchqJob };

/** Postings read while the panel is open, by firm, candidate and posting: the details page opens again at once. */
const read = new Map<string, BenchqJob>();
let sessionGeneration = 0;

/** The job's posting (backend/api/routes_job_search.py): its description, employment type, work mode and posted date,
 * which the applications list the panel has carries none of. Read when `postingId` is given (the details page is open),
 * once per posting, and again on Try again. */
export function usePosting(firmId: string | null, userId: string, candidateId: string, postingId: string | null, onSessionExpired: () => void) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; posting: Posting } | null>(null);
  const id = firmId && postingId ? JSON.stringify([firmId, userId, candidateId, postingId]) : null;
  const key = `${id ?? ""}:${attempt}`;
  const cached = id ? read.get(id) : undefined;
  // The latest callback, without a new read each time the panel hands a new one.
  const expired = useRef(onSessionExpired);
  useEffect(() => { expired.current = onSessionExpired; });
  useEffect(() => {
    if (!id || !firmId || !postingId || cached) return;
    let isCurrent = true;
    const generation = sessionGeneration;
    getCandidateJob(firmId, candidateId, postingId).then(
      (posting) => {
        if (!isCurrent || generation !== sessionGeneration) return;
        read.set(id, posting);
        setResult({ key, posting: { status: "ready", posting } });
      },
      (error: unknown) => {
        if (!isCurrent || generation !== sessionGeneration) return;
        if (isSessionExpired(error)) expired.current();
        setResult({ key, posting: { status: "error" } });
      },
    );
    return () => { isCurrent = false; };
  }, [id, firmId, candidateId, postingId, key, cached]);
  const retry = useCallback(() => setAttempt((now) => now + 1), []);
  const posting: Posting = !id ? { status: "none" } : cached ? { status: "ready", posting: cached }
    : result?.key === key ? result.posting : { status: "loading" };
  return { posting, retry };
}

/** What the panel's memory of postings loses when the panel closes or the BDE signs out. */
export function forgetPostings() {
  sessionGeneration += 1;
  read.clear();
}
