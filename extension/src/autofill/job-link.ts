import { siteOf } from "./job-check";

/**
 * Which links are one job's page, for the panel: the add-job card asks for a site only on such a link, since it can't
 * read a page it may not read yet. The same rule as `src/page/job.ts` `isJobLink`, kept as a copy because page.js has
 * to stand alone (vite.config.ts: it shares no code with the panel). `job-link.test.ts` keeps the two the same.
 */

/** A link's job, named in its query: Greenhouse's gh_jid, Indeed's jk and vjk, LinkedIn's currentJobId, Taleo's job… */
const JOB_KEY = /^(?:gh_jid|jk|vjk|jl|jobid|job_id|currentjobid|reqid|req_id|requisitionid|job)$/i;
/** Hosts whose links are job pages past their home: careers.acme.com, jobs.lever.co, application systems. */
const JOB_HOST = /^(?:jobs|careers|apply)\.|(?:^|\.)(?:breezy\.hr|recruitee\.com|applytojob\.com|taleo\.net|myworkdayjobs\.com|icims\.com)$/i;
/** A path's job word: /careers/…, /jobs/…, /job-details/…. */
const JOB_PART = /^(?:jobs?|careers?|positions?|openings?|vacanc(?:y|ies)|requisitions?|opportunit(?:y|ies)|postings?|job-?(?:details?|listings?|openings?|opportunit(?:y|ies)|postings?))$/i;
/** A part that makes a link a list of jobs: a search, its results, a team's or a place's jobs. */
const LIST_PART = /(?:^|[-_.]|job)(?:search|results?)(?:[-_.]|$)|^(?:all|list|index|home|page|teams?|departments?|locations?|categor(?:y|ies)|benefits|culture|students?|university|faq|about|saved|alerts?)$/i;
/** A language first ("en", "en-US") and an action last ("/job", "/apply"), which don't say which job. */
const LANGUAGE = /^[a-z]{2}(?:[-_][a-z]{2,4})?$/i;
const ACTION = /^(?:job|apply|applications?|details?|description|view|overview)$/i;

function linkOf(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function partsOf(link: URL): string[] {
  const parts = link.pathname.split("/").filter(Boolean);
  while (parts.length > 0 && LANGUAGE.test(parts[0]!)) parts.shift();
  while (parts.length > 1 && ACTION.test(parts.at(-1)!)) parts.pop();
  return parts;
}

const namesJobInQuery = (link: URL) => [...link.searchParams].some(([key, value]) => JOB_KEY.test(key) && value.trim() !== "");

/** A path that ends at a job word (/careers, /en/jobs/) or at a list (/jobs/search, /careers/teams, /jobs/page/2). */
function endsAtList(parts: string[]): boolean {
  const last = parts.at(-1);
  return !last || JOB_PART.test(last) || LIST_PART.test(last) || (/^\d{1,3}$/.test(last) && parts.at(-2)?.toLowerCase() === "page");
}

/** Whether a link is one job's page: the job named in its query, a path that goes past a job word to the job itself
 * (/careers/qa-engineer, /jobs/123), or a job host's link past its home (jobs.lever.co/acme/5f1c). Never a careers
 * home or a list of jobs. */
export function isJobLink(url: string): boolean {
  const link = linkOf(url);
  if (!link) return false;
  if (/(?:^|\.)adzuna\.com$/i.test(link.hostname) && /^\/details\/\d+\/?$/.test(link.pathname)) return true;
  if (namesJobInQuery(link)) return true;
  const parts = partsOf(link);
  if (endsAtList(parts)) return false;
  return parts.some((part) => JOB_PART.test(part)) || (JOB_HOST.test(link.hostname) && parts.length >= 2);
}


const sameUrl = (url: string) => url.replace(/#(?:top|apply|application|description)?$/i, "").replace(/\/+$/, "");

/** Query keys that name a job. Other keys (tracking, the source of a click) don't tell two jobs apart. */
const JOB_KEYS = /^(job|jl|gh_jid|jk|vjk|jobid|job_id|id|req|reqid|req_id|requisitionid|pid|currentjobid)$/i;

/** What names a link's job: its site without the subdomain (Greenhouse sends `boards.` to `job-boards.`), its path, and
 * the query keys that name a job. */
export function jobKeyOf(url: string) {
  try {
    const link = new URL(url);
    const site = siteOf(link.hostname);
    const path = link.pathname.toLowerCase().replace(/\/+$/, "");
    return {
      site,
      board: link.hostname.replace(/^www\./, "").replace(/^(?:job-boards|boards)\.greenhouse\.io$/, "boards.greenhouse.io"),
      route: /^#!?\/|[?&=]/.test(link.hash) ? link.hash : "",
      // Adzuna's tracked link (/land/ad/<id>) opens the listing (/details/<id>): one job at two addresses.
      path: site === "adzuna.com" ? path.replace(/^\/land\/ad\/(\d+)$/, "/details/$1") : path,
      ids: new Map([...link.searchParams].filter(([key]) => JOB_KEYS.test(key)).map(([key, value]) => [key.toLowerCase(), value])),
    };
  } catch {
    return null;
  }
}

/** The same job's page, however it was reached: the same site, the same path or a page under it (Lever's `/apply`,
 * Ashby's `/application`), and no job id that differs. */
export function isSameJob(page: string, known: string): boolean {
  if (sameUrl(page) === sameUrl(known)) return true;
  const [here, saved] = [jobKeyOf(page), jobKeyOf(known)];
  if (!here || !saved || here.board !== saved.board || here.route !== saved.route) return false;
  const under = (inner: string, outer: string) => inner === outer || (outer.length > 1 && inner.startsWith(`${outer}/`));
  if (!under(here.path, saved.path) && !under(saved.path, here.path)) return false;
  // The same job ids on both, or one side's id written in the other's path (Greenhouse's gh_jid=8329677 on
  // /jobs/8329677): an id the other side has nowhere can be another job's.
  return [...new Set([...here.ids.keys(), ...saved.ids.keys()])].every((key) => {
    const [mine, theirs] = [here.ids.get(key), saved.ids.get(key)];
    if (mine !== undefined && theirs !== undefined) return mine === theirs;
    const segments = (mine === undefined ? here.path : saved.path).split("/");
    return segments.includes((mine ?? theirs ?? "").toLowerCase());
  });
}
