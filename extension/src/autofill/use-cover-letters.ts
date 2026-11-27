import { useCallback, useEffect, useRef, useState } from "react";
import { getCoverLetters, isSessionExpired, type CoverLetter } from "../api";

/** The job's cover letters in BenchQ, as the panel's cover letter picker shows them. `none`: there's no confirmed job to
 * ask about yet. */
export type CoverLetters =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; letters: CoverLetter[] };

/** The cover letters BenchQ holds for the connected job (backend/api/routes_cover_letters.py, newest first), read once
 * the job is confirmed and again on Try again. */
export function useCoverLetters(jobId: string | null, onSessionExpired: () => void) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; letters: CoverLetters } | null>(null);
  const key = `${jobId ?? ""}:${attempt}`;
  // The latest callback, without a new read each time the panel hands a new one.
  const expired = useRef(onSessionExpired);
  useEffect(() => { expired.current = onSessionExpired; });
  useEffect(() => {
    if (!jobId) return;
    let isCurrent = true;
    getCoverLetters(jobId).then(
      (letters) => { if (isCurrent) setResult({ key, letters: { status: "ready", letters } }); },
      (error: unknown) => {
        if (!isCurrent) return;
        if (isSessionExpired(error)) expired.current();
        setResult({ key, letters: { status: "error" } });
      },
    );
    return () => { isCurrent = false; };
  }, [jobId, key]);
  const retry = useCallback(() => setAttempt((now) => now + 1), []);
  const letters: CoverLetters = !jobId ? { status: "none" } : result?.key === key ? result.letters : { status: "loading" };
  return { letters, retry };
}
