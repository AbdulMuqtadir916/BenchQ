import type { PageJob } from "../autofill/types";
import { collapse, textOf } from "./labels";

/** The job a page shows, for adding it to a candidate's jobs (the add-job plan, decided 2026-11-11): the page's own
 * JobPosting data (schema.org JSON-LD, which most job boards and application systems publish) first, else its heading,
 * its site and its main text. The description stays as the page wrote it (HTML from the JobPosting data); BenchQ reads
 * it as text. Runs in the page, so it must not import shared runtime code. */

const MAX_DESCRIPTION = 100_000;
const MAX_LINE = 300;

/** A link that names one job: …/jobs/123, ?gh_jid=…, a jobs. or careers. site, or an application system's site. */
const JOB_LINK = /\/(jobs?|careers?|positions?|openings?|vacanc(y|ies)|requisitions?|job-?details?|job-listing)\/|[?&](gh_jid|jk|jobid|job_id|currentjobid|reqid|req_id|job)=|\/\/(jobs|careers|apply)\.|(breezy\.hr|recruitee\.com|applytojob\.com|taleo\.net|myworkdayjobs\.com|icims\.com)\//i;
export const isJobLink = (url: string) => JOB_LINK.test(url);

/** An Apply button or link, as a job's page has. */
const hasApply = (doc: Document) => Array.from(doc.querySelectorAll("a, button, [role='button'], input[type='submit']"))
  .some((control) => {
    const label = collapse(control.textContent || control.getAttribute("value") || "");
    return label.length <= 40 && /\bapply\b/i.test(label);
  });

type JsonRecord = Record<string, unknown>;

function jobPostingIn(node: unknown): JsonRecord | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = jobPostingIn(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object" || node === null) return null;
  const record = node as JsonRecord;
  if (record["@graph"]) return jobPostingIn(record["@graph"]);
  const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
  return types.includes("JobPosting") ? record : null;
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

function fromStructuredData(doc: Document): Omit<PageJob, "url" | "isJobPage"> | null {
  for (const script of Array.from(doc.querySelectorAll("script[type='application/ld+json']"))) {
    try {
      const posting = jobPostingIn(JSON.parse(script.textContent ?? ""));
      if (!posting) continue;
      const organisation = posting.hiringOrganization;
      return {
        title: text(posting.title),
        company: typeof organisation === "string" ? collapse(organisation) : text((organisation as JsonRecord | undefined)?.name),
        description: typeof posting.description === "string" ? posting.description.trim() : "",
        location: placeOf(posting) || null,
        ids: identifiersOf(posting),
        links: typeof posting.url === "string" ? [posting.url] : [],
      };
    } catch {
      // A page's broken structured data gives nothing; the page itself is read instead.
    }
  }
  return null;
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

/** The job on the page when the page is a job's page: it publishes JobPosting data, or it's on a job link and has an
 * Apply button. Any other page reads as no job, and its text isn't read. `url` is the page's own link. */
export function readJob(doc: Document, url = doc.URL): PageJob {
  const found = fromStructuredData(doc);
  const isJobPage = Boolean(found?.title) || (isJobLink(url) && hasApply(doc));
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
