import { useEffect, useState } from "react";
import type { Application } from "../api";
import { isSameJob, isSavedJob } from "./AddJobCard";
import { readJobPage } from "./tab-bridge";
import type { JobSummary, PageJob } from "./types";

/** The job on the tab's page as the page shows it now (`readJobPage`, as Add job reads it), read each time `isOpen`
 * turns on: the job's details page takes from it what BenchQ doesn't hold. Nothing while closed, or on a page that
 * shows no job. */
export function usePageJob(tabId: number, isOpen: boolean): PageJob | null {
  const [reading, setReading] = useState<PageJob | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let isCurrent = true;
    readJobPage(tabId).then(
      (page) => { if (isCurrent) setReading(page?.isJobPage ? page : null); },
      () => { if (isCurrent) setReading(null); },
    );
    return () => { isCurrent = false; };
  }, [tabId, isOpen]);
  return isOpen ? reading : null;
}

/** Whether the page's job is the connected one: its page (or one under it, its form), or the same listing. */
export const isThisJob = (found: PageJob, job: JobSummary, details: Application | null) =>
  Boolean(job.url && isSameJob(found.url, job.url))
  || isSavedJob(found, { title: job.title, company: job.company, location: details?.location ?? null, url: job.url });
