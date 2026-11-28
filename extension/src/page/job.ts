import type { PageJob } from "../autofill/types";
import { companyLogo } from "./job-logo";
import { UNRELATED, DETAIL_KEYS, linesOf, microdataDetails, modeIn, pageDetails, postingDetails, type JobDetails } from "./job-details";
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

function isAdzunaDetail(link: URL | null): boolean {
  return Boolean(link && /(?:^|\.)adzuna\.com$/i.test(link.hostname) && /^\/details\/\d+\/?$/.test(link.pathname));
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
  if (isAdzunaDetail(link)) return true;
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
const hasApply = (doc: ParentNode) => Array.from(doc.querySelectorAll("a, button, [role='button'], input[type='submit']"))
  .some((control) => {
    if (control.closest(UNRELATED)) return false;
    const label = collapse(control.textContent || control.getAttribute("value") || "");
    // SmartRecruiters' Apply says "I'm interested"; its id says apply (st-apply).
    return (label.length <= 40 && /\bapply\b|\bi[’']?m interested\b/i.test(label))
      || /(?:^|[-_\s])apply(?:[-_\s]|$)/i.test(`${control.id} ${control.getAttribute("data-sr-track") ?? ""}`);
  });

type JsonRecord = Record<string, unknown>;

/** Collect graph nodes as well as listings: employers and logos can be separate, locally referenced records. */
function collectRecords(node: unknown, out: JsonRecord[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRecords(item, out);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as JsonRecord;
  out.push(record);
  if (record["@graph"]) collectRecords(record["@graph"], out);
  if (Array.isArray(record.itemListElement)) {
    for (const item of record.itemListElement) collectRecords((item as JsonRecord | null)?.item ?? item, out);
  }
}

/** A JobPosting's text, its HTML entities read ("Strategy &amp; Business" is "Strategy & Business"). */
const text = (value: unknown) => {
  if (typeof value !== "string") return "";
  if (!value.includes("&")) return collapse(value);
  const area = document.createElement("textarea");
  area.innerHTML = value;
  return collapse(area.value);
};

/** "Dallas, TX" from a JobPosting's place, or "Remote" for a telecommute job with no place. */
function placeOf(posting: JsonRecord): string {
  const places = Array.isArray(posting.jobLocation) ? posting.jobLocation : [posting.jobLocation];
  const named = places.flatMap((place) => {
    const address = (place as JsonRecord | undefined)?.address as JsonRecord | string | undefined;
    if (typeof address === "string") return [collapse(address)];
    const country = address?.addressCountry;
    const countryName = typeof country === "string" ? country : (country as JsonRecord | undefined)?.name;
    const parts = [address?.addressLocality, address?.addressRegion, countryName].map(text).filter(Boolean);
    return parts.length ? [parts.join(", ")] : [];
  });
  const required = (Array.isArray(posting.applicantLocationRequirements) ? posting.applicantLocationRequirements
    : [posting.applicantLocationRequirements]).map((place) => text((place as JsonRecord | undefined)?.name)).filter(Boolean);
  if (named.length) {
    const places = [...new Set(named)].join("; ");
    return required.length && text(posting.jobLocationType).toUpperCase() === "TELECOMMUTE"
      ? `${places} · Remote (${required.join("; ")})` : places;
  }
  if (text(posting.jobLocationType).toUpperCase() !== "TELECOMMUTE") return required.join("; ");
  return required.length ? `Remote (${required.join("; ")})` : "Remote";
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

const idsInText = (lines: string[]) => [...lines.join("\n").slice(0, MAX_DESCRIPTION).replace(/[^\S\n]*-[^\S\n]*/g, "-").matchAll(ID_LINE)]
  .map((match) => match[1]!).filter((code) => /\d/.test(code));

/** The links a page gives itself besides its address: its canonical link and its og:url. */
function linksOf(doc: Document, url: string, posting?: JsonRecord): string[] {
  const current = codesOf(url);
  const candidates = [posting?.url, doc.querySelector("link[rel='canonical']")?.getAttribute("href"),
    doc.querySelector("meta[property='og:url']")?.getAttribute("content")];
  return [...new Set(candidates.flatMap(value => {
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const link = new URL(value, url);
      if (!/^https?:$/.test(link.protocol) || link.username || link.password) return [];
      const target = codesOf(link.href);
      if (current.size && target.size && ![...current].some(id => target.has(id))) return [];
      return [link.href];
    } catch { return []; }
  }))];
}

/** Use a cleaner publisher URL only when it preserves the active job identity. */
function postingUrl(url: string, links: string[]): string | undefined {
  const here = linkOf(url);
  if (!here) return;
  const identity = (link: URL) => {
    const params = new URLSearchParams(link.search);
    for (const key of [...params.keys()]) {
      if (/^(?:utm_\w+|gh_src|fbclid|gclid)$/i.test(key)) params.delete(key);
    }
    params.sort();
    const hash = /^#(?:top|apply|description)$/i.test(link.hash) ? "" : link.hash;
    return JSON.stringify([link.origin, link.pathname.replace(/\/$/, ""), params.toString(), hash]);
  };
  const current = identity(here);
  return links.find(value => {
    const link = new URL(value);
    return value !== url && isJobLink(value) && current === identity(link);
  });
}

/** The job codes a link names: its job keys' values and the codes in its path (a long number, a UUID, R123456). */
function codesOf(url: string): Set<string> {
  const link = linkOf(url);
  if (!link) return new Set();
  const keyed = [...link.searchParams].filter(([key, value]) => JOB_KEY.test(key) && value.trim()).map(([, value]) => value);
  const coded = link.pathname.match(/(?<![a-z0-9])(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{5,}|(?:jr|req|r)[-_]?\d{4,})(?![a-z0-9])/gi) ?? [];
  return new Set([...keyed, ...coded].map((code) => code.toLowerCase()));
}

/** The page's JobPostings, each once (a page may give its data twice). */
function postingsOn(doc: Document, url: string): JsonRecord[] {
  const records: JsonRecord[] = [];
  for (const script of Array.from(doc.querySelectorAll("script[type='application/ld+json']"))) {
    try {
      collectRecords(JSON.parse(script.textContent ?? ""), records);
    } catch {
      // A page's broken structured data gives nothing; the page itself is read instead.
    }
  }
  const localId = (record: JsonRecord) => {
    const id = record["@id"];
    if (typeof id !== "string" || !id.trim()) return;
    try { return new URL(id, url).href; } catch { return; }
  };
  const byId = new Map<string, JsonRecord>();
  for (const record of records) {
    const id = localId(record);
    if (id && Object.keys(record).length > 1) byId.set(id, record);
  }
  const resolve = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as JsonRecord;
    const id = localId(record);
    return id && byId.has(id) ? { ...byId.get(id), ...record } : record;
  };
  const seen = new Set<string>();
  return records.flatMap(posting => {
    const types = Array.isArray(posting["@type"]) ? posting["@type"] : [posting["@type"]];
    if (!types.some(type => typeof type === "string" && /^(?:https?:\/\/schema\.org\/)?JobPosting$/.test(type))) return [];
    const key = JSON.stringify(posting);
    if (seen.has(key)) return [];
    seen.add(key);
    const employer = resolve(posting.hiringOrganization);
    if (!employer || typeof employer !== "object" || Array.isArray(employer)) return [posting];
    return [{ ...posting, hiringOrganization: { ...employer, logo: resolve((employer as JsonRecord).logo) } }];
  });
}

function fromPosting(posting: JsonRecord): Omit<PageJob, "url" | "isJobPage"> {
  const organisation = posting.hiringOrganization;
  return {
    title: roleTitle(text(posting.title)),
    company: companyOf(typeof organisation === "string" ? collapse(organisation) : text((organisation as JsonRecord | undefined)?.name)),
    description: typeof posting.description === "string" ? posting.description.trim() : "",
    location: placeOf(posting) || null,
    ids: identifiersOf(posting),
    links: typeof posting.url === "string" ? [posting.url] : [],
    ...postingDetails(posting),
  };
}

/** Job sites a page may give as its site name, which isn't the hiring company. */
const JOB_SITES = /^(greenhouse|lever|ashby|workable|smartrecruiters|workday|icims|jobvite|bamboohr|breezy( hr)?|recruitee|linkedin|indeed|adzuna|oorwin|adp)$/i;

const MAX_COMPANY = 60;

/** The company a page's title names around the job's title: "Job Application for QA Engineer at Robinhood",
 * "Zoox - QA Engineer", "QA Engineer @ OpenAI". */
function companyFromTitle(pageTitle: string, jobTitle: string): string {
  if (!jobTitle || !pageTitle.includes(jobTitle)) return "";
  const rest = pageTitle.replace(jobTitle, " | ").replace(/job application for|apply for|apply to/gi, " ");
  return rest.split(/\s*(?:\||–|—|·|\s-\s|@|\bat\b)\s*/i).map(collapse)
    .find((part) => part && part.length <= MAX_COMPANY && !/^(careers?|jobs?|job board)$/i.test(part) && !JOB_SITES.test(part)) ?? "";
}

/** The words a site adds to its own name: "Careers", "Jobs site", "Candidate Experience page", "Talent Community". */
const SITE_WORDS = String.raw`(?:candidate experience(?:\s+(?:page|site))?|career(?:s)?(?:\s+(?:site|page|portal|home|center))?|job(?:s)?(?:\s+(?:site|board|page|portal))?|talent\s+(?:community|network))`;

/** A company as a site names itself: "Amazon.jobs" is Amazon, "JPMC Candidate Experience page" JPMC, "Careers at Acme"
 * Acme. The site's words go only after a space or a separator, so a name that ends in one keeps it ("AcmeJobs"), and a
 * name that is only those words is no company (PR #140's review). */
export function companyOf(name: string): string {
  if (/^company(?: logo)?$/i.test(name.trim())) return "";
  const named = name.replace(/\.(?:jobs|careers|com|io|co)$/i, "").replace(/^(?:careers|jobs)\s+(?:at|with)\s+/i, "").trim();
  if (new RegExp(`^${SITE_WORDS}$`, "i").test(named)) return "";
  return named.replace(new RegExp(String.raw`(?:\s*[-–|:·]\s*|\s+)${SITE_WORDS}\s*$`, "i"), "").trim();
}

/** The company a page's own logo names: "Discord Logo" gives "Discord". */
function logoCompany(doc: Element): string {
  for (const image of Array.from(doc.querySelectorAll("img[alt]"))) {
    if (image.closest(UNRELATED)) continue;
    const name = /^(.{2,60}?)\s+logo$/i.exec(collapse(image.getAttribute("alt") ?? ""))?.[1];
    if (name && companyOf(name) && !JOB_SITES.test(name)) return name;
  }
  return "";
}

/** The page's text from the job's own title on (the site's chrome comes before it) to its copyright line, if any. */
/** The words of a line or title, to compare them: case and spacing aside. */
const wordsOf = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** The line the job's title heads, else the line a title like "QA Engineer | Acme Careers" begins with: the description
 * starts there, after the site's breadcrumbs. With neither, the whole page (PR #140's review). */
function titleLine(lines: string[], title: string): number {
  const wanted = wordsOf(title);
  const exact = lines.findIndex((line) => wordsOf(line) === wanted);
  if (exact >= 0 || !wanted) return exact;
  return lines.findIndex((line) => {
    const words = wordsOf(line);
    return words.length >= 4 && wanted.startsWith(words) && /^\s*(?:[|:,(–—-]|at\s)/.test(wanted.slice(words.length));
  });
}

/** Keep the publisher's formatted description unless it is empty or a teaser for the visible full text. */
function capturedDescription(doc: Document, structured: string | undefined, visible: string): string {
  if (!structured) return visible;
  const template = doc.createElement("template");
  template.innerHTML = structured;
  const plain = collapse(template.content.textContent ?? "");
  if (!plain || /^(?:view job|apply(?: now)?|job description|see (?:full )?description)[.!]?$/i.test(plain)) return visible;
  const prefix = plain.replace(/(?:\.{3}|…)(?:\s*(?:read|show) more)?$/i, "").trim();
  if (prefix !== plain && prefix.length >= 12 && collapse(visible).includes(prefix) && visible.length > plain.length) return visible;
  return structured;
}

function descriptionOf(lines: string[], title: string): string {
  const start = Math.max(0, titleLine(lines, title));
  const end = lines.findIndex((line, n) => n > start && /^(?:©|copyright\b|(?:similar|related|recommended) (?:jobs|positions)\s*:?$|apply for this (?:job|position)\s*:?$|application form\s*:?$)/i.test(line) && (n > start + 1 || /^(?:©|copyright\b)/i.test(line)));
  return lines.slice(start, end > start ? end : undefined).join("\n");
}

/** Job boards reuse navigation labels in headings, metadata and sometimes even JobPosting.title. */
/** Labels and section headings that never name a role, so a listing's "Responsibilities" heading isn't its title. */
const GENERIC_TITLE = new RegExp(`^(?:${[
  "(?:set|manage) your cookie preferences", "cookie (?:preferences|settings|policy|consent)", "view job", "job (?:details?|description|overview|summary|requirements|responsibilities|duties)", "apply(?: now)?", "how to apply",
  "candidate (?:center|portal|experience)", "career portal", "overview", "summary", "careers?", "skills", "description", "requirements", "(?:key )?responsibilities", "duties",
  "(?:minimum |basic |preferred |required )?qualifications", "benefits", "perks(?: (?:and|&) benefits)?",
  "about (?:us|the (?:role|job|position|team|company)|this (?:role|job|position))",
  "what (?:you(?:'|’)ll do|you will do|we offer)", "who you are", "(?:position|role) (?:summary|overview)",
].join("|")})[:.!]?$`, "i");

/** Requisition codes are useful posting evidence, including when the publisher repeats them in title markup. */
const ID_LABEL = /^(?:job|req(?:uisition)?|posting|vacancy|position|reference)\s*(?:id|number|no\.?|code|#)(?=$|[\s:#.-])/i;
const BARE_ID = /^(?:#?\d+|(?:req(?:uisition)?|jr|job|r)[\s#:_-]*\d[\w.-]*|[a-z]{1,12}\s*[-_]\s*\d[\w.-]*|\d{4,}[a-z]{1,5}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const idKey = (value: string) => value.toLowerCase().replace(/\s*-\s*/g, "-").trim();
function roleTitle(value: string | undefined, ids: readonly string[] = []): string {
  const full = collapse(value ?? "");
  // "QA Engineer | View Job" keeps the role before the label; "View Job | Adzuna" has none, only the site's name.
  const parts = full.split(/(\s*(?:[|–—]|\s-\s)\s*)/);
  const label = parts.findIndex((part, index) => index % 2 === 0 && /^(?:view job|job details?)$/i.test(part));
  const title = label < 0 ? full : parts.slice(0, Math.max(label - 1, 0)).join("");
  const fields = title.split(/\s*[|·]\s*/);
  const isCode = (part: string) => ID_LABEL.test(part) || BARE_ID.test(part) || ids.includes(idKey(part));
  if (isCode(fields[0]!)) return "";
  const role = fields.filter(part => !isCode(part)).join(" | ");
  return GENERIC_TITLE.test(role) || /^(?:(?:job )?location|company|employer|posted date|experience|duration)\s*:|^(?:remote|hybrid|onsite|full[- ]time|part[- ]time)$/i.test(role) ? "" : role;
}

function fromPage(doc: Document, main: Element, lines: string[], ids: readonly string[]): Omit<PageJob, "url" | "isJobPage"> {
  const meta = (property: string) => collapse(doc.querySelector(`meta[property='${property}']`)?.getAttribute("content") ?? "");
  const candidateTitle = (value?: string) => roleTitle(value, ids);
  const heading = (selector: string) => Array.from(main.querySelectorAll(selector)).filter(el => !el.closest(UNRELATED)).map(el => candidateTitle(textOf(el))).find(Boolean);
  const labelled = lines.map(line => candidateTitle(/^(?:job title|position|role)\s*:\s*(.+)$/i.exec(line)?.[1])).find(Boolean);
  // The Apply control as a line of text, SmartRecruiters' "I'm interested" included (as hasApply reads it).
  const applyLine = lines.findIndex(line => /^(?:apply(?: now| for this job)?|i[’']?m interested)$/i.test(line));
  const preceding = lines[applyLine - 1] ?? "";
  const metadataTitle = candidateTitle(meta("og:title")) || candidateTitle(doc.title);
  const outerHeading = Array.from(doc.querySelectorAll("h1")).find(el => !el.closest(UNRELATED));
  // Metadata can be a portal name. Only use it if it corroborates a visible listing line.
  const supportedLine = metadataTitle ? lines.find(line => candidateTitle(line) && titleLine([line], metadataTitle) === 0) : undefined;
  const itemTitle = heading('[itemprop="title"], [data-automation-id="jobPostingHeader"]');
  // A corroborated line beats the unverified line above Apply. The document h1 comes last: it can be the site's name.
  const title = labelled || itemTitle || heading("h1") || supportedLine
    || (preceding.length <= 100 && !/[.!?:]$/.test(preceding) ? candidateTitle(preceding) : "")
    || heading("h2") || (outerHeading && candidateTitle(textOf(outerHeading))) || "";
  const siteName = meta("og:site_name");
  const namedCompany = heading('[data-testid="job-company"], [data-automation-id="companyName"], [data-qa="job-posting-company"], .job-company, .job-company-name');
  const descriptionBox = Array.from(main.querySelectorAll('[itemprop~="description"], [data-automation-id="jobPostingDescription"], [data-testid="job-description"], #job-description, .job-description'))
    .find(el => !el.closest(UNRELATED) && !!el.textContent?.trim());
  const orgName = Array.from(main.querySelectorAll('[itemprop~="hiringOrganization"] [itemprop~="name"]')).find(el => !el.closest(UNRELATED));
  const employer = lines.map((line, index) => /^(?:company|employer|hiring organization(?: name)?)\s*:\s*(.+)$/i.exec(line)?.[1]
    || (/^(?:company|employer|hiring organization):?$/i.test(line) && lines[index + 1]?.length && lines[index + 1]!.length <= MAX_COMPANY && !lines[index + 1]!.includes(":") ? lines[index + 1] : undefined)).find(Boolean);
  return {
    title,
    company: companyOf(orgName?.getAttribute("content") ?? orgName?.textContent ?? "") || companyOf(employer ?? "") || companyOf(namedCompany ?? "") || companyFromTitle(collapse(doc.title), title) || logoCompany(main) || (JOB_SITES.test(siteName) ? "" : companyOf(siteName)),
    description: descriptionBox ? linesOf(descriptionBox).join("\n") || collapse(descriptionBox.textContent ?? "") : descriptionOf(lines, title),
    location: null,
  };
}

/** The job on the page when the page is one job's page: it publishes one JobPosting, or it's on one job's link
 * (`isJobLink`) and has an Apply button. A careers home or a list of jobs (`isJobListLink`, or several JobPostings) is
 * no job's page, whatever one of its jobs says, and neither is any other page: their text isn't read. `url` is the
 * page's own link. */
export function readJob(doc: Document, url = doc.URL): PageJob {
  // An app that shows another job in place can keep the last page's JobPosting data: a posting whose link names other
  // job codes than this page's is that other page's (a refresh would read this one), so it's set aside.
  const empty = { title: "", company: "", description: "", location: null, url, isJobPage: false };
  if (isJobListLink(url) || !doc.body) return empty;
  const main = doc.querySelector("main, [role='main']") ?? doc.body;
  const declared = postingsOn(doc, url);
  const apply = hasApply(doc);
  const adzuna = isAdzunaDetail(linkOf(url));
  const unavailable = /(?:applications? (?:have |has |are )?closed|no longer accepting applications|job is not available in your region)/i;
  if (!declared.length && !adzuna && !apply && !unavailable.test(main.textContent ?? "")) return empty;
  const articles = Array.from(main.querySelectorAll("article")).filter(el => !el.closest(UNRELATED));
  const root = articles.length === 1 && articles[0]!.querySelector("h1,h2") && hasApply(articles[0]!) ? articles[0]! : main;
  const lines = linesOf(root);
  const ids = idsInText(lines).map(id => id.toLowerCase());
  const here = codesOf(url);
  const titleExclusions = [...ids, ...here, ...declared.flatMap(identifiersOf).map(idKey)];
  const page = fromPage(doc, root, lines, titleExclusions);
  const candidates = declared.filter(posting => {
    const theirs = codesOf(text(posting.url));
    return !here.size || !theirs.size || [...theirs].some(id => here.has(id));
  });
  const matchesId = (posting: JsonRecord) => identifiersOf(posting).some(id => ids.includes(id.toLowerCase().replace(/\s*-\s*/g, "-")));
  const matchesTitle = (posting: JsonRecord) => !!page.title && wordsOf(text(posting.title)) === wordsOf(page.title);
  const exact = candidates.filter(matchesId);
  const relevant = exact.length ? exact : candidates;
  const byTitle = relevant.filter(matchesTitle);
  const posting = relevant.length === 1 ? relevant[0] : byTitle.length === 1 ? byTitle[0] : undefined;
  if (candidates.length > 1 && (!posting || (!exact.length && articles.length > 1))) return empty;
  // Two different codes can identify one posting (a board ID and an employer's requisition).
  // A visible and structured requisition with the same prefix should agree even for two identically titled roles.
  const namespace = (id: string) => /^[a-z]+[-_#]?(?=\d)/i.exec(idKey(id))?.[0];
  const otherRequisition = posting && identifiersOf(posting).some(id => {
    const prefix = namespace(id);
    return prefix && ids.some(visible => namespace(visible) === prefix);
  });
  const conflicting = posting && ids.length && identifiersOf(posting).length && !matchesId(posting)
    && (otherRequisition || (page.title && !matchesTitle(posting)));
  const active = conflicting ? undefined : posting;
  const found = active ? fromPosting(active) : null;
  const facts = ids.length > 0 && lines.some(line => /^(?:location|experience|posted date)\s*:/i.test(line));
  const closed = lines.some(line => unavailable.test(line));
  const isJobPage = Boolean(found && text(active?.title)) || (apply && (isJobLink(url) || facts)) || (closed && facts && !!page.title) || adzuna;
  if (!isJobPage) return empty;
  const title = (roleTitle(found?.title, titleExclusions) || page.title).slice(0, MAX_LINE);
  // What the JobPosting states first, else what the page's own lines state (job-details.ts); nothing it doesn't state.
  const stated = pageDetails(doc, title, root);
  const micro = microdataDetails(root);
  const location = (found?.location ?? micro.location ?? stated.location ?? page.location)?.slice(0, MAX_LINE) ?? null;
  const details: JobDetails = {};
  const pay = found?.salaryMin !== undefined || found?.salaryMax !== undefined ? found
    : micro.salaryMin !== undefined || micro.salaryMax !== undefined ? micro : stated;
  for (const key of DETAIL_KEYS) {
    const value = key.startsWith("salary") ? pay[key] : found?.[key] ?? micro[key] ?? stated[key];
    if (value !== undefined) Object.assign(details, { [key]: value });
  }
  // How the job is done: what the page itself says first ("Hybrid"), since a JobPosting marks any remote-friendly job
  // TELECOMMUTE; then that mark; then the place ("Remote (US)").
  const workMode = stated.workMode ?? found?.workMode ?? (location ? modeIn(location) : undefined);
  const links = linksOf(doc, url, active);
  const source = postingUrl(url, links);
  const company = (found?.company || page.company).slice(0, MAX_LINE);
  const logoUrl = companyLogo(root, found?.company ? active?.hiringOrganization : null, company, url);
  return {
    isJobPage,
    title,
    company,
    ...(logoUrl && { logoUrl }),
    description: capturedDescription(doc, found?.description, page.description).slice(0, MAX_DESCRIPTION),
    location,
    ...details,
    ...(workMode ? { workMode } : {}),
    url,
    ids: [...new Set([...(found?.ids ?? []), ...ids].map((id) => id.toLowerCase()))].slice(0, MAX_IDS),
    links: links.slice(0, MAX_IDS),
    ...(source && { postingUrl: source }),
  };
}

/** The application may omit posting details that its own public listing still serves. */
export async function readJobForSave(doc: Document): Promise<PageJob> {
  const original = doc.URL;
  const page = readJob(doc, original);
  const parent = new URL(original);
  const lever = /^jobs(?:\.eu)?\.lever\.co$/.test(parent.hostname) && /^\/[^/]+\/[\da-f-]{36}\/apply\/?$/i.test(parent.pathname);
  const workable = parent.hostname === "apply.workable.com" && /^\/[^/]+\/j\/[a-z0-9]+\/apply\/?$/i.test(parent.pathname);
  // An application page's own heading and buttons aren't a posting's description: only a real one saves the fetch.
  const described = !doc.querySelector("form input, form textarea") && (page.description ?? "").replace(page.title ?? "", "").replace(/\b(apply( now| for this job)?|submit( application)?)\b/gi, "").trim().length >= 200;
  if ((!lever && !workable) || (page.isJobPage && page.title && described)) return page;
  parent.pathname = parent.pathname.replace(/apply\/?$/, "");
  if (lever) parent.pathname = parent.pathname.replace(/\/$/, "");
  parent.search = parent.hash = "";
  try {
    const response = await fetch(parent, { mode: "same-origin", credentials: "omit", signal: AbortSignal.timeout(5000) });
    if (doc.URL !== original) return readJob(doc);
    if (!response.ok || new URL(response.url).origin !== parent.origin || new URL(response.url).pathname.replace(/\/$/, "") !== parent.pathname.replace(/\/$/, "")) return page;
    const html = await response.text();
    if (doc.URL !== original) return readJob(doc);
    const listing = readJob(new DOMParser().parseFromString(html, "text/html"), response.url);
    if (!listing.isJobPage || !listing.title) return page;
    // The posting fills in what the application page lacks, and a field the posting leaves out keeps the page's: a
    // listing without a description never erases the page's (CodeRabbit's review of cf130dea).
    const stated = (job: PageJob) => Object.fromEntries(Object.entries(job).filter(([, value]) => value !== null && value !== undefined
      && value !== "" && !(Array.isArray(value) && value.length === 0)));
    const merged = { ...stated(page), ...stated(listing), isJobPage: true, url: original, postingUrl: listing.postingUrl || listing.url } as PageJob;
    if (listing.company && listing.company !== page.company && !listing.logoUrl) delete merged.logoUrl;
    return merged;
  } catch {
    return doc.URL === original ? page : readJob(doc);
  }
}
