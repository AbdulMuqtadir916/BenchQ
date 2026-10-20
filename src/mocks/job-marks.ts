import { JobMarkKind, JobMarkSchema, type JobMark } from "@/lib/schemas/job";
import { findInFirm, mockResult, newId } from "./_shared";
import { currentPrincipal, currentUser } from "./auth";
import { changed, table } from "./db";
import { allJobs } from "./jobs";
import { firmScoped } from "./membership";

/** Every person's saved / hidden jobs (docs/02 §6.x), persisted in the browser's demo data. */
export const allJobMarks: JobMark[] = table("jobMarks", JobMarkSchema, () => []);

const mine = (firmId: string, userId: string) => allJobMarks.filter((mark) => mark.firmId === firmId && mark.userId === userId);

export const jobMarksMock = firmScoped("jobMarks", {
  /** The signed-in person's marks. A support view reads none: marks belong to people, not to the firm's work. */
  list: (firmId: string): Promise<JobMark[]> => {
    const principal = currentPrincipal();
    return mockResult(principal.kind === "firm" ? mine(firmId, principal.userId) : []);
  },

  /** Save or hide a job of this firm for yourself. Marking it again changes nothing. */
  mark: (firmId: string, jobId: string, kind: JobMarkKind): Promise<JobMark> => {
    findInFirm(allJobs(), firmId, jobId, "Job");
    const user = currentUser();
    const existing = mine(firmId, user.id).find((mark) => mark.jobId === jobId && mark.kind === JobMarkKind.parse(kind));
    if (existing) return mockResult(existing);
    const mark = JobMarkSchema.parse({ id: newId("jmark"), firmId, userId: user.id, jobId, kind, createdAt: new Date().toISOString() });
    allJobMarks.push(mark);
    changed("jobMarks");
    return mockResult(mark);
  },

  /** Unsave or unhide. Removing a mark you don't have changes nothing. */
  unmark: (firmId: string, jobId: string, kind: JobMarkKind): Promise<void> => {
    const user = currentUser();
    const index = allJobMarks.findIndex((mark) => mark.firmId === firmId && mark.userId === user.id && mark.jobId === jobId && mark.kind === kind);
    if (index >= 0) {
      allJobMarks.splice(index, 1);
      changed("jobMarks");
    }
    return mockResult(undefined);
  },
}, { mark: "job.apply", unmark: "job.apply" });
