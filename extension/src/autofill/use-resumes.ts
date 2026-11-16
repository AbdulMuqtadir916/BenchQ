import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getResumeListing, isSessionExpired, type ResumeListing } from "../api";
import { defaultResume, resumeChoices, tailorSource, type ResumeChoice } from "./resume-choices";

/** The list is read again when the BDE comes back to the panel, at most this often: a résumé tailored or added on the
 * website meanwhile shows without a reload. */
export const REFRESH_AT_MOST_EVERY_MS = 15_000;

/** The candidate's résumés Autofill can answer from, and the one picked. It starts on the résumé the application names,
 * else this job's tailored one, else the base in use; a pick sticks only for this candidate/application. */
export type Resumes =
  | { status: "loading" }
  | { status: "error" }
  | { status: "unavailable" }
  | { status: "missing" }
  | { status: "ready"; choices: ResumeChoice[]; picked: ResumeChoice | null };

export type ApplicationContextStatus = "loading" | "ready" | "unavailable";

type Options = {
  firmId: string | null;
  candidateId: string;
  applicationId: string;
  applicationStatus: ApplicationContextStatus;
  jobId: string | null;
  /** The résumé the application names: the one it was sent with, else the newest tailored for its job. */
  namedId: string | null;
  onSessionExpired: () => void;
  onAccessLost: () => void;
};

/** A listing as loaded for one request; `listing` is null when the request failed. */
type Loaded = { request: string; listing: ResumeListing | null };

export function useResumes({ firmId, candidateId, applicationId, applicationStatus, jobId, namedId, onSessionExpired, onAccessLost }: Options) {
  const [attempt, setAttempt] = useState(0);
  // A refresh reads the list again behind the one on show (a tailoring that finished, the BDE back in the panel).
  const [refreshes, setRefreshes] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The last refresh failed, the list on show kept: a tailoring that finished then says so, with Reload resumes.
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [chosen, setChosen] = useState<{ context: string; id: string } | null>(null);
  const context = `${candidateId}:${applicationId}`;
  const request = `${firmId}:${candidateId}:${attempt}`;

  useEffect(() => {
    if (!firmId || applicationStatus !== "ready") return;
    let isCurrent = true;
    getResumeListing(firmId, candidateId)
      .then((listing) => {
        if (!isCurrent) return;
        setLoaded({ request, listing });
        setRefreshFailed(false);
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        if (isSessionExpired(error)) onSessionExpired();
        else if ((error as { status?: number }).status === 404) onAccessLost();
        else {
          // A refresh that fails keeps the list on show and says so; a first read that fails says so too.
          setLoaded((shown) => (shown?.request === request && shown.listing ? shown : { request, listing: null }));
          setRefreshFailed(true);
        }
      });
    return () => { isCurrent = false; };
  }, [firmId, candidateId, applicationStatus, request, refreshes, onSessionExpired, onAccessLost]);

  const listing = loaded?.request === request ? loaded.listing : undefined;
  const choices = useMemo(() => (listing ? resumeChoices(listing, jobId, namedId) : []), [listing, jobId, namedId]);
  const namedResumeMissing = Boolean(namedId && listing && !choices.some(({ id }) => id === namedId));
  const chosenId = chosen?.context === context ? chosen.id : null;
  const pickedId = chosenId && choices.some(({ id }) => id === chosenId) ? chosenId : defaultResume(choices, namedId);
  const resumes: Resumes = applicationStatus === "loading" ? { status: "loading" }
    : applicationStatus === "unavailable" ? { status: "unavailable" }
      : !firmId || listing === null ? { status: "error" }
        : listing === undefined ? { status: "loading" }
            : namedResumeMissing ? { status: "missing" }
          : { status: "ready", choices, picked: choices.find(({ id }) => id === pickedId) ?? null };
  const pick = useCallback((id: string) => setChosen({ context, id }), [context]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  const shownPick = useRef({ context, id: pickedId });
  useEffect(() => { shownPick.current = { context, id: pickedId }; });
  // Reads the list again behind the one on show, the résumé in use kept as the pick: a tailoring the read finds shows
  // in the list, never as a silent switch away from the answers on the form (PR #140's review).
  const refresh = useCallback(() => {
    const inUse = shownPick.current;
    if (inUse.id) setChosen((now) => (now?.context === inUse.context ? now : { context: inUse.context, id: inUse.id! }));
    setRefreshes((count) => count + 1);
  }, []);
  // Back in the panel, at most once every REFRESH_AT_MOST_EVERY_MS: a résumé tailored or added on the website shows.
  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last < REFRESH_AT_MOST_EVERY_MS) return;
      last = Date.now();
      refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  const pickedChoice = resumes.status === "ready" ? resumes.picked : null;
  // What Tailor reads: the base of the résumé in use, else the active one.
  const source = useMemo(() => (listing ? tailorSource(listing, pickedChoice) : null), [listing, pickedChoice]);
  return { resumes, pick, retry, refresh, refreshFailed, source };
}
