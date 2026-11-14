import type { JobCheck, JobSummary, PageSignals } from "./types";
import { canonical, tokens } from "./text";

const COMPANY_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "gmbh", "group",
  "holdings",
]);

function parsed(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export const hostOf = (url: string) => parsed(url)?.hostname.replace(/^www\./, "") ?? "";
const pathOf = (url: string) => parsed(url)?.pathname ?? "";

/** What "It's the right job" confirms: the job a page shows (`JobCheck.detected`), on its site. Another job on that
 * site, as on a job board many employers share, asks again. */
export const confirmationKey = (url: string, detected: string) => `${hostOf(url)} · ${detected}`;

/** Whether the BDE confirmed a job on `host`: an address they type there doesn't take the tab from its job. */
export const isConfirmedHost = (confirmed: string[], host: string) =>
  confirmed.some((key) => key.startsWith(`${host} · `));

function companyWords(company: string | null): string[] {
  return canonical(company ?? "").split(" ").filter((word) => word && !COMPANY_SUFFIXES.has(word));
}

function companySeen(words: string[], text: string, compactUrl: string): boolean {
  const seen = new Set(text.split(" "));
  return words.every((word) => seen.has(word)) || compactUrl.includes(words.join(""));
}

function titleOverlap(title: string | null, text: string): number {
  const wanted = [...tokens(title ?? "")];
  if (wanted.length === 0) return 1;
  const seen = tokens(text);
  return wanted.filter((word) => seen.has(word)).length / wanted.length;
}

const TITLE_SEEN = 0.6;

/** Two names of one company, give or take a suffix ("Acme Bank Inc") or a longer form ("Robinhood Markets"). */
export function sameCompany(left: string | null, right: string | null): boolean {
  const [ours, theirs] = [companyWords(left), companyWords(right)];
  return ours.length > 0 && theirs.length > 0 && (companySeen(ours, theirs.join(" "), "") || companySeen(theirs, ours.join(" "), ""));
}

/** Places that may be one: they share a word, or one isn't named. Two "city, region" places compare their cities, so
 * Dallas, TX and Austin, TX are two places although they share a state. */
function samePlace(left: string, right: string): boolean {
  const both = left.includes(",") && right.includes(",");
  const [here, there] = [tokens(both ? left.split(",")[0]! : left), tokens(both ? right.split(",")[0]! : right)];
  return here.size === 0 || there.size === 0 || [...here].some((word) => there.has(word));
}

/** Whether a page's job is this saved job, at whatever link: the same company and the same role, word for word give or
 * take order and filler. Two places that share no word are two jobs. */
export function sameListing(found: { title: string; company: string; location?: string | null },
  job: { title: string | null; company: string | null; location?: string | null }): boolean {
  if (!sameCompany(found.company, job.company)) return false;
  const [saved, seen] = [tokens(job.title ?? ""), tokens(found.title)];
  if (saved.size === 0 || saved.size !== seen.size || ![...saved].every((word) => seen.has(word))) return false;
  return samePlace(found.location ?? "", job.location ?? "");
}

/** Whether the page looks like a different job or company from the saved one. A posting's structured data says so
 * outright; otherwise the page has to show neither the company nor the role. A page with nothing to go on is no
 * conflict: the BDE still reviews every value. */
export function checkJob(job: JobSummary, page: PageSignals | null): JobCheck {
  if (!page) return { conflict: false, detected: "" };
  const words = companyWords(job.company);
  const { posting } = page;
  if (posting) {
    const detected = [posting.title, posting.company].filter(Boolean).join(" · ");
    const postedCompany = canonical(posting.company);
    const otherCompany = Boolean(postedCompany) && words.length > 0 && !companySeen(words, postedCompany, "");
    const otherRole = Boolean(posting.title) && titleOverlap(job.title, posting.title) < TITLE_SEEN;
    return { conflict: otherCompany || otherRole, detected };
  }
  const detected = page.heading || page.title;
  const text = canonical([page.title, page.heading, page.siteName].join(" "));
  if (!text) return { conflict: false, detected };
  const sameUrl = hostOf(page.url) === hostOf(job.url) && pathOf(page.url) === pathOf(job.url);
  if (sameUrl) return { conflict: false, detected };
  const compactUrl = (hostOf(page.url) + pathOf(page.url)).toLowerCase().replace(/[^a-z0-9]/g, "");
  const companyFound = words.length > 0 && companySeen(words, text, compactUrl);
  return { conflict: !companyFound && titleOverlap(job.title, text) < TITLE_SEEN, detected };
}
