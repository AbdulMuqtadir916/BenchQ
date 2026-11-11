import { useCallback, useEffect, useMemo, useState } from "react";
import { getResumeListing, isSessionExpired, type ResumeListing } from "../api";
import { defaultResume, resumeChoices, type ResumeChoice } from "./resume-choices";

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
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [chosen, setChosen] = useState<{ context: string; id: string } | null>(null);
  const context = `${candidateId}:${applicationId}`;
  const request = `${firmId}:${candidateId}:${attempt}`;

  useEffect(() => {
    if (!firmId || applicationStatus !== "ready") return;
    let isCurrent = true;
    getResumeListing(firmId, candidateId)
      .then((listing) => { if (isCurrent) setLoaded({ request, listing }); })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        if (isSessionExpired(error)) onSessionExpired();
        else if ((error as { status?: number }).status === 404) onAccessLost();
        else setLoaded({ request, listing: null });
      });
    return () => { isCurrent = false; };
  }, [firmId, candidateId, applicationStatus, request, onSessionExpired, onAccessLost]);

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
  return { resumes, pick, retry };
}
