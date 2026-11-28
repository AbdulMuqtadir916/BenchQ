/** The linked job's details as the panel words them. */
import type { Application, BenchqJob } from "../api";
import type { JobFacts } from "./JobDetails";
import type { JobSummary, PageJob } from "./types";

/** Pay under this is per hour. The job pool stores pay without its unit, and no yearly salary is this low. */
const HOURLY_BELOW = 1000;
const DAY_MS = 86_400_000;

const hourly = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const thousands = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const ago = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "$85–$95/hr", "$120k–$150k/yr" or "$90/hr"; null when the posting gave no pay. */
export function payText(min?: number | null, max?: number | null): string | null {
  const given = [min, max].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (given.length === 0) return null;
  const low = Math.min(...given);
  const high = Math.max(...given);
  const isHourly = high < HOURLY_BELOW;
  const amount = (value: number) => (isHourly ? `$${hourly.format(value)}` : `$${thousands.format(value / 1000)}k`);
  return `${low === high ? amount(high) : `${amount(low)}–${amount(high)}`}${isHourly ? "/hr" : "/yr"}`;
}

/** "Found today", "Found 3 days ago", "Found last month"; null without a date. */
export function foundText(at?: string | null, now = Date.now()): string | null {
  const time = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(time)) return null;
  const days = Math.max(0, Math.floor((now - time) / DAY_MS));
  const [count, unit]: [number, Intl.RelativeTimeFormatUnit] = days < 7 ? [days, "day"]
    : days < 30 ? [Math.floor(days / 7), "week"]
      : days < 365 ? [Math.floor(days / 30), "month"]
        : [Math.floor(days / 365), "year"];
  return `Found ${ago.format(-count, unit)}`;
}

/** How a job is done, as the panel words it. */
export const WORK_MODE = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" } as const;

/** An employment type BenchQ holds as a code ("FULL_TIME", "full_time", "CONTRACT") in words ("Full-time",
 * "Contract"). Words a source gave ("Full-time", "Contract to hire") stay as they are. */
export function employmentWords(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (!/^(?:[A-Z]+(?:_[A-Z]+)*|[a-z]+(?:_[a-z]+)*)$/.test(text)) return text;
  const words = text.toLowerCase().split("_");
  const phrase = words.length === 2 && (words[0] === "full" || words[0] === "part") && words[1] === "time" ? words.join("-") : words.join(" ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** A posted date as anyone reads it, day first and the month in words: "10 Nov 2026", never an ambiguous 11/10. Read
 * as the local day, so a date-only "2026-11-10" isn't the 9th west of UTC. */
export const dateWords = (iso: string) => {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

/** What a job's page states besides its title, company and place, as the page or BenchQ holds it. */
export type StatedDetails = Partial<Pick<PageJob, "workMode" | "employmentType" | "salaryMin" | "salaryMax" | "salaryCurrency"
  | "salaryPeriod" | "postedAt" | "requisitionId">>;

const PER = { hour: "an hour", day: "a day", week: "a week", month: "a month", year: "a year" } as const;
const amount = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** What the page stated besides its title, company and place, each with its name, as the card shows it before the BDE
 * adds the job, so anyone can check it at a glance: [["Work mode", "Remote"], ["Employment", "Full-time"],
 * ["Pay", "USD 120,000–150,000 a year"], ["Posted", "10 Nov 2026"], ["Job ID", "R123456"]], in the design's order (the
 * pay on a row of its own). Only what the page stated. */
export function detailsOf(job: StatedDetails | PageJob): Array<[string, string]> {
  const { salaryMin: min, salaryMax: max } = job;
  const bound = min === undefined ? "Up to" : max === undefined ? "From" : "";
  const sum = min !== undefined && max !== undefined && min !== max ? `${amount(min)}–${amount(max)}` : amount(min ?? max ?? 0);
  const pay = min === undefined && max === undefined ? "" : [bound, job.salaryCurrency, sum, job.salaryPeriod && PER[job.salaryPeriod]].filter(Boolean).join(" ");
  const facts: Array<[string, string]> = [["Work mode", job.workMode ? WORK_MODE[job.workMode] : ""], ["Employment", job.employmentType ?? ""],
    ["Pay", pay], ["Posted", job.postedAt ? dateWords(job.postedAt) : ""], ["Job ID", job.requisitionId ?? ""]];
  return facts.filter(([, value]) => value);
}

/** HTML's text as the page reads it, without what its scripts and styles hold. */
export function textOfHtml(html: string): string {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  body.querySelectorAll("script, style, noscript, template").forEach((element) => element.remove());
  return body.textContent ?? "";
}

/** A job as its details page shows it: its title, company, place, logo and description, and what its page stated, each
 * worded as Add job words it (`detailsOf`). `pay`: the pay in words when the page stated none. */
export function factsOf(job: Pick<JobFacts, "title" | "company" | "location" | "logoUrl" | "description">, stated: StatedDetails,
  pay: string | null = null): JobFacts {
  const named = new Map(detailsOf(stated));
  return { ...job, workMode: named.get("Work mode") ?? null, employmentType: named.get("Employment") ?? null,
    pay: named.get("Pay") ?? pay, posted: named.get("Posted") ?? null, requisitionId: named.get("Job ID") ?? null };
}

const listedMode = (details: Application | null): PageJob["workMode"] => (details?.arr_remote || details?.remote ? "remote"
  : details?.arr_hybrid ? "hybrid" : details?.arr_onsite ? "onsite" : undefined);

/** A saved job as its details page shows it, as Add job showed it: each detail from what Add job read and BenchQ saved
 * (`stored`), else from the job's page as the tab shows it now (`live`), else from the jobs list (`details`). Pay stated
 * with its currency or period reads as Add job reads it ("USD 164,200–229,990 a year"); bounds alone, as the job list
 * reads them ("$164k–$230k/yr"). */
export function savedJobFacts(job: JobSummary, details: Application | null, stored: BenchqJob | null, live: PageJob | null): JobFacts {
  const bounds = [stored, live].find((source) => typeof source?.salaryMin === "number" || typeof source?.salaryMax === "number");
  const isWorded = Boolean(bounds?.salaryCurrency || bounds?.salaryPeriod);
  const stated: StatedDetails = {
    workMode: stored?.workMode ?? live?.workMode ?? listedMode(details),
    employmentType: employmentWords(stored?.employmentType ?? live?.employmentType ?? details?.employment_type ?? details?.job_type) ?? undefined,
    postedAt: stored?.postedAt ?? live?.postedAt ?? details?.posted_at ?? undefined,
    requisitionId: stored?.requisitionId ?? live?.requisitionId ?? undefined,
    ...(isWorded ? { salaryMin: bounds?.salaryMin ?? undefined, salaryMax: bounds?.salaryMax ?? undefined,
      salaryCurrency: bounds?.salaryCurrency ?? undefined, salaryPeriod: bounds?.salaryPeriod ?? undefined } : {}),
  };
  return factsOf({
    title: job.title || details?.title || stored?.title || live?.title || "Untitled role",
    company: job.company || details?.company || stored?.company || live?.company || "",
    location: details?.location ?? stored?.location ?? live?.location ?? null,
    logoUrl: details?.logoUrl ?? stored?.logoUrl ?? live?.logoUrl,
    description: stored?.descriptionHtml || live?.description || stored?.description || details?.description || null,
  }, stated, isWorded ? null : payText(bounds?.salaryMin ?? details?.salary_min, bounds?.salaryMax ?? details?.salary_max));
}

/** The first letter of a name, for the job's tile: by whole characters, so an emoji isn't cut in half. */
export const initialOf = (name: string) => (Array.from(name.trim())[0] ?? "").toUpperCase();
