import type { PageJob } from "../autofill/types";
import { collapse, textOf } from "./labels";

/** The job a page shows, for adding it to a candidate's jobs (the add-job plan, decided 2026-11-11): the page's own
 * JobPosting data (schema.org JSON-LD, which most job boards and application systems publish) first, else its heading,
 * its site and its main text. The description stays as the page wrote it (HTML from the JobPosting data); BenchQ reads
 * it as text. Runs in the page, so it must not import shared runtime code. */

const MAX_DESCRIPTION = 100_000;
const MAX_LINE = 300;

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
  if (namesJobInQuery(link)) return true;
  const parts = partsOf(link);
  if (endsAtList(parts)) return false;
  return parts.some((part) => JOB_PART.test(part)) || (JOB_HOST.test(link.hostname) && parts.length >= 2);
}

/** Whether a link is a careers home or a list of jobs: a job host's home (careers.acme.com/en), or a path that ends at a
 * job word or a list. Not one that names a job in its query: LinkedIn's and Indeed's lists show the job they name. */
export function isJobListLink(url: string): boolean {
  const link = linkOf(url);
  if (!link || namesJobInQuery(link)) return false;
  const parts = partsOf(link);
  return parts.length === 0 ? JOB_HOST.test(link.hostname) : endsAtList(parts);
}

/** An Apply button or link, as a job's page has. */
const hasApply = (doc: Document) => Array.from(doc.querySelectorAll("a, button, [role='button'], input[type='submit']"))
  .some((control) => {
    const label = collapse(control.textContent || control.getAttribute("value") || "");
    return label.length <= 40 && /\bapply\b/i.test(label);
  });

type JsonRecord = Record<string, unknown>;

/** Every JobPosting in a piece of JSON-LD: one record, a list, a graph, or a list of jobs (ItemList) holding them. */
function jobPostingsIn(node: unknown, out: JsonRecord[] = []): JsonRecord[] {
  if (Array.isArray(node)) {
    for (const item of node) jobPostingsIn(item, out);
    return out;
  }
  if (typeof node !== "object" || node === null) return out;
  const record = node as JsonRecord;
  if (record["@graph"]) return jobPostingsIn(record["@graph"], out);
  const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
  if (types.includes("JobPosting")) out.push(record);
  if (Array.isArray(record.itemListElement)) {
    for (const item of record.itemListElement) jobPostingsIn((item as JsonRecord | null)?.item ?? item, out);
  }
  return out;
}

const text = (value: unknown) => (typeof value === "string" ? collapse(value) : "");

/** "Dallas, TX" from a JobPosting's place, or "Remote" for a telecommute job with no place. */
function placeOf(posting: JsonRecord): string {
  const places = Array.isArray(posting.jobLocation) ? posting.jobLocation : [posting.jobLocation];
  const named = places.flatMap((place) => {
    const address = (place as JsonRecord | undefined)?.address as JsonRecord | string | undefined;
    if (typeof address === "string") return [collapse(address)];
    const parts = [address?.addressLocality, address?.addressRegion].map(text).filter(Boolean);
    return parts.length ? [parts.join(", ")] : [];
  });
  if (named.length) return [...new Set(named)].join("; ");
  return text(posting.jobLocationType).toUpperCase() === "TELECOMMUTE" ? "Remote" : "";
}

/** The codes a JobPosting gives its job: its identifier, one value or several. */
function identifiersOf(posting: JsonRecord): string[] {
  const items = Array.isArray(posting.identifier) ? posting.identifier : [posting.identifier];
  return items.map((item) => (typeof item === "object" && item ? (item as JsonRecord).value : item))
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number").map(String);
}

/** A "Job ID: R123456", "Req ID 4521" or "Requisition #2024-118" line: the code a page shows for its job. */
const ID_LINE = /\b(?:job|req|requisition|posting)\s*(?:id|number|no\.?|#|code)\s*[:#]?\s*([a-z0-9][a-z0-9_-]{2,39})\b/gi;
const MAX_IDS = 10;

const idsInText = (doc: Document) => [...(doc.body?.textContent ?? "").slice(0, MAX_DESCRIPTION).matchAll(ID_LINE)]
  .map((match) => match[1]!).filter((code) => /\d/.test(code));

/** The links a page gives itself besides its address: its canonical link and its og:url. */
const linksOf = (doc: Document) => [doc.querySelector<HTMLLinkElement>("link[rel='canonical']")?.href,
  doc.querySelector("meta[property='og:url']")?.getAttribute("content")].filter((link): link is string => Boolean(link));

/** The page's JobPostings, each once (a page may give its data twice). */
function postingsOn(doc: Document): JsonRecord[] {
  const found: JsonRecord[] = [];
  for (const script of Array.from(doc.querySelectorAll("script[type='application/ld+json']"))) {
    try {
      jobPostingsIn(JSON.parse(script.textContent ?? ""), found);
    } catch {
      // A page's broken structured data gives nothing; the page itself is read instead.
    }
  }
  const seen = new Set<string>();
  return found.filter((posting) => {
    const key = JSON.stringify([text(posting.title), text(posting.url), identifiersOf(posting)]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fromPosting(posting: JsonRecord): Omit<PageJob, "url" | "isJobPage"> {
  const organisation = posting.hiringOrganization;
  return {
    title: text(posting.title),
    company: typeof organisation === "string" ? collapse(organisation) : text((organisation as JsonRecord | undefined)?.name),
    description: typeof posting.description === "string" ? posting.description.trim() : "",
    location: placeOf(posting) || null,
    ids: identifiersOf(posting),
    links: typeof posting.url === "string" ? [posting.url] : [],
  };
}

/** Job sites a page may give as its site name, which isn't the hiring company. */
const JOB_SITES = /^(greenhouse|lever|ashby|workable|smartrecruiters|workday|icims|jobvite|bamboohr|breezy( hr)?|recruitee|linkedin|indeed)$/i;

const MAX_COMPANY = 60;

/** The company a page's title names around the job's title: "Job Application for QA Engineer at Robinhood",
 * "Zoox - QA Engineer", "QA Engineer @ OpenAI". */
function companyFromTitle(pageTitle: string, jobTitle: string): string {
  if (!jobTitle || !pageTitle.includes(jobTitle)) return "";
  const rest = pageTitle.replace(jobTitle, " | ").replace(/job application for|apply for|apply to/gi, " ");
  return rest.split(/\s*(?:\||–|—|·|\s-\s|@|\bat\b)\s*/i).map(collapse)
    .find((part) => part && part.length <= MAX_COMPANY && !/^(careers?|jobs?|job board)$/i.test(part) && !JOB_SITES.test(part)) ?? "";
}

function fromPage(doc: Document, url: string): Omit<PageJob, "url" | "isJobPage"> {
  const meta = (property: string) => collapse(doc.querySelector(`meta[property='${property}']`)?.getAttribute("content") ?? "");
  const heading = doc.querySelector("h1");
  const main = doc.querySelector("main, [role='main'], article") ?? doc.body;
  const title = (heading ? collapse(textOf(heading)) : "") || meta("og:title") || collapse(doc.title);
  const siteName = meta("og:site_name");
  return {
    title,
    company: (JOB_SITES.test(siteName) ? "" : siteName) || companyFromTitle(collapse(doc.title), title)
      || new URL(url).hostname.replace(/^www\./, ""),
    description: main ? (main as HTMLElement).innerText?.trim() ?? collapse(textOf(main)) : "",
    location: null,
  };
}

/** The job on the page when the page is one job's page: it publishes one JobPosting, or it's on one job's link
 * (`isJobLink`) and has an Apply button. A careers home or a list of jobs (`isJobListLink`, or several JobPostings) is
 * no job's page, whatever one of its jobs says, and neither is any other page: their text isn't read. `url` is the
 * page's own link. */
export function readJob(doc: Document, url = doc.URL): PageJob {
  const postings = postingsOn(doc);
  const found = postings.length === 1 ? fromPosting(postings[0]!) : null;
  const isList = postings.length > 1 || isJobListLink(url);
  const isJobPage = !isList && (Boolean(found?.title) || (isJobLink(url) && hasApply(doc)));
  if (!isJobPage) return { title: "", company: "", description: "", location: null, url, isJobPage };
  const page = fromPage(doc, url);
  return {
    isJobPage,
    title: (found?.title || page.title).slice(0, MAX_LINE),
    company: (found?.company || page.company).slice(0, MAX_LINE),
    description: (found?.description || page.description).slice(0, MAX_DESCRIPTION),
    location: (found?.location ?? page.location)?.slice(0, MAX_LINE) ?? null,
    url,
    ids: [...new Set([...(found?.ids ?? []), ...idsInText(doc)].map((id) => id.toLowerCase()))].slice(0, MAX_IDS),
    links: [...new Set([...(found?.links ?? []), ...linksOf(doc)])].slice(0, MAX_IDS),
  };
}
