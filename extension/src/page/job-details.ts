import type { PageJob } from "../autofill/types";
import { collapse } from "./labels";

/**
 * The details a job's page states besides its title, company and description (decided 2026-11-12): where and how the
 * job is done, its employment type, its pay, when it was posted and its requisition ID. Read deterministically, in this
 * order: the page's schema.org JobPosting (JSON-LD), lines the page labels ("Job type: Full-time", or "Location" above
 * "Dallas, TX"), then pay its text states with a pay word. A detail the page doesn't state stays out: nothing is guessed
 * (a bare "$" names no currency, "3 days ago" no date, "05/06/2026" no day). Runs in the page, so it imports no shared
 * runtime code (vite.config.ts).
 */

export const DETAIL_KEYS = ["workMode", "employmentType", "salaryMin", "salaryMax", "salaryCurrency", "salaryPeriod",
  "postedAt", "requisitionId"] as const;
export type JobDetails = Partial<Pick<PageJob, (typeof DETAIL_KEYS)[number]>> & { location?: string };
type Json = Record<string, unknown>;
type Pay = Pick<JobDetails, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod">;

const EMPLOYMENT: [RegExp, string][] = [
  [/^full ?time/, "Full-time"], [/^part ?time/, "Part-time"], [/^contract(?:or)? ?to ?(?:hire|perm)|^c2h$/, "Contract-to-hire"],
  [/^contract(?:or|ual)?(?: (?:role|position|job|work))?$|^c2c$|^corp ?to ?corp$/, "Contract"], [/^temp(?:orary)?$/, "Temporary"],
  [/^intern(?:ship)?$/, "Internship"], [/^per ?diem$/, "Per diem"], [/^volunteer$/, "Volunteer"], [/^seasonal$/, "Seasonal"],
];

/** "Full-time" from "FULL_TIME", "Full time" or "full-time, permanent"; several as "Full-time, Contract". */
export function employmentOf(value: string): string | undefined {
  const labels = value.split(/\s*(?:,|\/|\||;|\bor\b|&)\s*/i).flatMap((part) => {
    const word = part.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    const found = EMPLOYMENT.find(([pattern]) => pattern.test(word));
    return found ? [found[1]] : [];
  });
  return labels.length ? [...new Set(labels)].join(", ") : undefined;
}

const MODES: [RegExp, NonNullable<PageJob["workMode"]>][] = [
  [/\bhybrid\b/i, "hybrid"], [/\b(?:remote|work from home|wfh|telecommut\w*)\b/i, "remote"],
  [/\b(?:on-?site|in[- ]office|in[- ]person|office[- ]based)\b/i, "onsite"],
];
export const modeIn = (value: string) => MODES.find(([pattern]) => pattern.test(value))?.[1];
/** A title says how the job is done only in its own aside: "QA Engineer (Remote)", "QA Engineer - Hybrid". */
const titleMode = (title: string) => {
  const aside = /\(([^)]*)\)\s*$|[-–|]\s*([^-–|]+)$/.exec(title);
  return aside ? modeIn(aside[1] ?? aside[2] ?? "") : undefined;
};

const CODES = "USD|CAD|EUR|GBP|INR|AUD|NZD|SGD|CHF|JPY|MXN";
const SIGNS: Record<string, string> = { "US$": "USD", "C$": "CAD", "CA$": "CAD", "A$": "AUD", "AU$": "AUD", "€": "EUR", "£": "GBP", "₹": "INR" };
const MONEY = new RegExp(String.raw`(US\$|CA?\$|AU?\$|[$€£₹]|\b(?:${CODES})\b)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s?([kK]\b)?(?:\s?\b(${CODES})\b)?`, "g");
const PERIODS: [RegExp, NonNullable<Pay["salaryPeriod"]>][] = [
  [/(?:\b(?:per|an?)|\/)\s*(?:hour|hr)\b|\bhourly\b|\/\s*h\b/i, "hour"], [/(?:\b(?:per|a)|\/)\s*day\b|\bdaily\b/i, "day"],
  [/(?:\b(?:per|a)|\/)\s*(?:week|wk)\b|\bweekly\b/i, "week"], [/(?:\b(?:per|a)|\/)\s*(?:month|mo)\b|\bmonthly\b/i, "month"],
  [/(?:\b(?:per|an?)|\/)\s*(?:year|yr|annum)\b|\bannual(?:ly)?\b|\byearly\b/i, "year"],
];
const UNITS: Record<string, NonNullable<Pay["salaryPeriod"]>> = { HOUR: "hour", DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };
const PAY_WORDS = /\b(?:salary|salaries|pay|compensation|wage|wages|rate|base|range|hourly|annual|ote)\b/i;

const amountOf = (digits: string, thousands?: string) => {
  const value = Number(digits.replace(/,/g, "")) * (thousands ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

/** The pay a line states: a range of amounts ("$120,000 - $150,000", "USD 60–70/hr") or one amount with its period
 * ("$65 an hour"). The first amount needs a currency sign or code; the period and currency only when the line says them. */
export function payIn(text: string): Pay | undefined {
  const amounts = [...text.matchAll(MONEY)];
  for (let n = 0; n < amounts.length; n += 1) {
    const first = amounts[n]!;
    if (!first[1] && !first[4]) continue;
    const next = amounts[n + 1];
    const between = next ? text.slice(first.index! + first[0].length, next.index) : "";
    const isRange = Boolean(next) && /^\s*(?:-|–|—|to)\s*$/i.test(between);
    const end = isRange ? next!.index! + next![0].length : first.index! + first[0].length;
    // The period the amount goes with: the one after it ("… per year"), else the one just before ("Hourly: $60-70"),
    // never another figure's ("40 hours/week, … $143,700 - $194,400 per year").
    const periodIn = (part: string) => PERIODS.find(([pattern]) => pattern.test(part))?.[1];
    const period = periodIn(text.slice(end, end + 30)) ?? periodIn(text.slice(Math.max(0, first.index! - 30), first.index));
    if (!isRange && !period) continue;
    const min = amountOf(first[2]!, first[3] ?? (isRange ? next![3] : undefined));
    const max = isRange ? amountOf(next![2]!, next![3]) : min;
    if (min === undefined || max === undefined || max < min) continue;
    const sign = first[1] ?? next?.[1];
    const currency = first[4] ?? next?.[4] ?? (sign && sign !== "$" ? SIGNS[sign] ?? sign : undefined);
    return { salaryMin: min, salaryMax: max, ...(currency ? { salaryCurrency: currency } : {}), ...(period ? { salaryPeriod: period } : {}) };
  }
  return undefined;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2026-11-10" from a date a page writes out (ISO, "Nov 10, 2026", "10 November 2026", or a day/month order only one
 * reading of fits); never from "3 days ago" or a date that isn't real or is still to come. */
export function dateOf(value: string, monthFirst = false): string | undefined {
  let found: [number, number, number] | undefined;
  let match: RegExpExecArray | null;
  if ((match = /\b(\d{4})-(\d{2})-(\d{2})/.exec(value))) found = [+match[1]!, +match[2]!, +match[3]!];
  else if ((match = /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(value))) found = [+match[3]!, MONTHS.indexOf(match[1]!.toLowerCase()) + 1, +match[2]!];
  else if ((match = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})\b/i.exec(value))) found = [+match[3]!, MONTHS.indexOf(match[2]!.toLowerCase()) + 1, +match[1]!];
  else if ((match = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(value))) {
    const [a, b, year] = [+match[1]!, +match[2]!, +match[3]!];
    if (a > 12 && b <= 12) found = [year, b, a];
    else if (b > 12 || a === b || monthFirst) found = [year, a, b];
  }
  if (!found) return undefined;
  const [year, month, day] = found;
  const time = Date.UTC(year, month - 1, day);
  const iso = new Date(time).toISOString().slice(0, 10);
  const isReal = month >= 1 && iso === `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isReal && year >= 2000 && time <= Date.now() + 86_400_000 ? iso : undefined;
}

/** A requisition ID as a page writes it: a code with a digit, at most 60 characters. */
export const idOf = (value: unknown) => {
  const code = typeof value === "number" ? String(value) : typeof value === "string" ? collapse(value) : "";
  return /^[A-Za-z0-9][A-Za-z0-9_.#/-]{0,59}$/.test(code) && /\d/.test(code) ? code : undefined;
};

/** What a JobPosting states: its location type, employment type, base salary, posting date and identifier. */
export function postingDetails(posting: Json): JobDetails {
  const types = (Array.isArray(posting.employmentType) ? posting.employmentType : [posting.employmentType])
    .filter((type): type is string => typeof type === "string");
  const identifier = Array.isArray(posting.identifier) ? posting.identifier[0] : posting.identifier;
  return definedOnly({
    workMode: String(posting.jobLocationType ?? "").toUpperCase().includes("TELECOMMUTE") ? "remote" : undefined,
    employmentType: employmentOf(types.join(", ")),
    ...salaryOf(posting.baseSalary),
    postedAt: typeof posting.datePosted === "string" ? dateOf(posting.datePosted) : undefined,
    requisitionId: idOf(typeof identifier === "object" && identifier ? (identifier as Json).value : identifier),
  });
}

/** What a page states in schema.org microdata (`itemprop="employmentType"`, `<meta itemprop="datePosted">`, the
 * address's parts), as SmartRecruiters and others publish a JobPosting. */
export function microdataDetails(doc: Document): JobDetails {
  const root = doc.querySelector("[itemtype*='JobPosting']") ?? doc;
  const prop = (name: string, within: ParentNode = root) => {
    const element = within.querySelector(`[itemprop~='${name}']`);
    return element ? collapse(element.getAttribute("content") ?? element.getAttribute("datetime") ?? element.textContent ?? "") : "";
  };
  const place = [prop("addressLocality"), prop("addressRegion")].filter(Boolean).join(", ");
  return definedOnly({
    location: place || undefined,
    employmentType: employmentOf(prop("employmentType")),
    workMode: prop("jobLocationType").toUpperCase().includes("TELECOMMUTE") ? "remote" : undefined,
    postedAt: dateOf(prop("datePosted")),
    requisitionId: idOf(prop("identifier")),
  });
}

function salaryOf(value: unknown): Pay {
  const base = (Array.isArray(value) ? value[0] : value) as Json | undefined;
  if (!base || typeof base !== "object") return {};
  const amount = base.value;
  const range = (typeof amount === "object" && amount ? amount : { value: amount }) as Json;
  const number = (item: unknown) => (typeof item === "number" ? item : typeof item === "string" ? Number(item.replace(/,/g, "")) : NaN);
  const [min, max] = [number(range.minValue ?? range.value), number(range.maxValue ?? range.value)];
  if (!(min > 0) || !(max >= min)) return {};
  const currency = typeof base.currency === "string" && /^[A-Za-z]{3}$/.test(base.currency) ? base.currency.toUpperCase() : undefined;
  const period = UNITS[String(range.unitText ?? base.unitText ?? "").toUpperCase()];
  return { salaryMin: min, salaryMax: max, ...(currency ? { salaryCurrency: currency } : {}), ...(period ? { salaryPeriod: period } : {}) };
}

/** A chip that is only a workplace or an employment type. */
const CHIP_MODE = /^(?:remote|hybrid|on-?site|in[- ]office|in[- ]person)(?:\s*\([^)]*\))?$/i;
const CHIP_TYPE = /^(?:full|part)[\s_-]?time$|^(?:contract(?:or)?|contract[\s-]to[\s-]hire|internship|temporary|per diem|seasonal)$/i;
/** A line that is another heading, never a value: "Job categories", "Teams", "Job details". */
const HEADING = /^(?:job |related )?(?:categories|category|teams?|details|description|overview|summary|benefits|departments?|locations?)$/i;
const LOCATION_LABEL = /^(?:job |work |primary |office )?(?:locations?|offices?)$/i;
const MODE_LABEL = /^(?:workplace(?: type)?|work(?:place)? (?:type|setting|arrangement|model|mode|style)|location type|remote(?: type| status| option)?)$/i;
const TYPE_LABEL = /^(?:(?:employment|job|position|contract|role|work|engagement) ?type|employment|commitment|schedule|time type|job schedule)$/i;
const PAY_LABEL = /^(?:(?:base|annual(?:ized)?|hourly|target|starting|expected|estimated|total|cash)\s+)*(?:pay|salary|compensation|wage|rate)(?:\s*(?:\/|&|and|or)\s*(?:pay|salary|compensation|wage|rate))?(?:\s+(?:range|rate|band))?$/i;
const POSTED_LABEL = /^(?:posted|date posted|posted on|posting date|published|date published|posted date|job posted)$/i;
const ID_LABEL = /^(?:job\s+)?(?:job|req|requisition|posting|reference|ref|vacancy)\.? ?(?:id|identification|number|no\.?|#|code)$/i;

const BLOCKS = new Set(["P", "LI", "DT", "DD", "DIV", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6", "SECTION", "ARTICLE",
  "MAIN", "ASIDE", "FORM", "UL", "OL", "TABLE", "TR", "BODY", "BLOCKQUOTE", "PRE", "LABEL", "BUTTON", "FIGCAPTION"]);
const SKIPPED = "script, style, noscript, template, svg, nav, header, footer, select";
/** Site chrome a page marks by name rather than by element: `div.footer`, a navbar, a menu. */
const CHROME = /^(?:site-?|global-?|page-?)?(?:footer|navbar|nav|menu)$|[-_]footer$|^footer[-_]/i;

/** The page's text as its lines, as it shows: one per block as the page lays it out (a label styled as its own line is
 * one), a line break where it breaks one, its inline pieces joined ("$200,000 - $225,000 USD" from three spans);
 * leaving out the site's navigation, header and footer and anything hidden. */
export function linesOf(root: Element): string[] {
  const view = root.ownerDocument.defaultView;
  const known = new Map<Element, { isBlock: boolean; isOut: boolean }>();
  const factsOf = (element: Element) => {
    let facts = known.get(element);
    if (!facts) {
      const display = view?.getComputedStyle?.(element).display ?? "";
      facts = { isBlock: display ? display !== "inline" && display !== "contents" : BLOCKS.has(element.tagName),
        isOut: display === "none" || element.matches(SKIPPED) || [...element.classList, element.id].some((token) => CHROME.test(token)) };
      known.set(element, facts);
    }
    return facts;
  };
  const lines: string[] = [];
  let block: Element | null = null;
  let breaks = true;
  const walker = root.ownerDocument.createTreeWalker(root, 5 /* NodeFilter.SHOW_ELEMENT | SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 1) {
      if ((node as Element).tagName === "BR") breaks = true;
      continue;
    }
    if (!node.parentElement || !node.textContent?.trim()) continue;
    let owner: Element | null = null;
    let isOut = false;
    for (let at: Element | null = node.parentElement; at && !isOut; at = at === root ? null : at.parentElement) {
      const facts = factsOf(at);
      isOut = facts.isOut;
      if (!owner && facts.isBlock) owner = at;
    }
    if (isOut) continue;
    if (owner !== block || breaks || !lines.length) lines.push("");
    lines[lines.length - 1] += ` ${node.textContent}`;
    [block, breaks] = [owner, false];
    if (lines.length > 3000) break;
  }
  return lines.map(collapse).filter(Boolean);
}

/** A short element the page names by what it holds (`job__location`, `workplaceTypes`): its text. */
const classed = (root: Element, name: RegExp) => Array.from(root.querySelectorAll("[class]"))
  .filter((element) => !element.closest(SKIPPED) && [...element.classList].some((token) => name.test(token)))
  .map((element) => collapse(element.textContent ?? "")).filter((text) => text.length >= 2 && text.length <= 120 && !text.includes(":"));
/** The text beside an icon the page names ("location"): the icon's own box, without the icon. */
const iconed = (root: Element, name: string) => {
  const icon = Array.from(root.querySelectorAll("[aria-label], [title]")).find((element) => !element.closest(SKIPPED)
    && !collapse(element.textContent ?? "") && (element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "").toLowerCase() === name);
  const seen = new Set<string>();
  const places = icon?.parentElement ? linesOf(icon.parentElement).filter((line) => !seen.has(line.toLowerCase()) && seen.add(line.toLowerCase())) : [];
  return places.join("; ") || undefined;
};
/** A place as a page lists it, without "and 1 more" (the link to its other places), which is never a place. */
const placeOf = (value: string) => {
  const text = value.replace(/\s*(?:and|\+)\s*\d+\s*more\b.*$/i, "").trim();
  return text.length >= 2 && text.length <= 120 ? text : undefined;
};
/** Lines that are only a chip: "Hybrid", "Full-time", "Remote (US)". */
const chips = (lines: string[]) => lines.filter((line) => line.length <= 30);
/** The page's own app data where it states a workplace (Ashby's "workplaceType": "Hybrid"). */
const appMode = (doc: Document) => {
  for (const script of Array.from(doc.querySelectorAll("script:not([type='application/ld+json'])"))) {
    const found = /"workplaceType"\s*:\s*"(remote|hybrid|on-?site)"/i.exec(script.textContent ?? "");
    if (found) return modeIn(found[1]!);
  }
  return undefined;
};

/** The values a page gives a label: "Label: value" on one line, or the label alone with its value on the next. */
function valuesOf(lines: string[], label: RegExp): string[] {
  return lines.flatMap((line, n) => {
    const colon = line.indexOf(":");
    if (colon > 0 && colon <= 40 && label.test(line.slice(0, colon).trim())) return [line.slice(colon + 1).trim()].filter(Boolean);
    const next = lines[n + 1];
    return label.test(line.replace(/:$/, "").trim()) && next && !HEADING.test(next) && !next.endsWith(":") ? [next] : [];
  });
}

const firstOf = <T>(values: string[], read: (value: string) => T | undefined) => {
  for (const value of values) {
    const found = read(value);
    if (found !== undefined) return found;
  }
  return undefined;
};

/** What the page itself states, read from its labelled lines and its pay statements. */
export function pageDetails(doc: Document, title: string): JobDetails {
  const root = doc.querySelector("main, [role='main'], article") ?? doc.body;
  if (!root) return {};
  const lines = linesOf(root);
  // An icon the page names "location" says it outright, before lines a menu of places may imitate.
  const location = firstOf([iconed(root, "location") ?? "", ...valuesOf(lines, LOCATION_LABEL),
    ...classed(root, /(?:^|__|-|_)(?:locations?|offices?)$/i)], placeOf);
  // A page in US English writes 11/12/2026 month first; any other leaves an order that both readings fit unread.
  const monthFirst = /^en(?:-us)?$/i.test(doc.documentElement.getAttribute("lang") ?? "");
  const payLines = lines.filter((line, n) => line.length <= 400 && /\d/.test(line)
    && PAY_WORDS.test([lines[n - 2] ?? "", lines[n - 1] ?? "", line].join(" ")));
  const idLine = firstOf(lines, (line) => /^(?:job|req|requisition)\.? ?(?:id|#|number)\s*#?\s+(\S+)$/i.exec(line)?.[1]);
  return definedOnly({
    location,
    workMode: firstOf(valuesOf(lines, MODE_LABEL), modeIn) ?? firstOf(chips(lines), (line) => (CHIP_MODE.test(line) ? modeIn(line) : undefined))
      ?? appMode(doc) ?? (location ? modeIn(location) : undefined) ?? titleMode(title),
    employmentType: firstOf(valuesOf(lines, TYPE_LABEL), employmentOf)
      ?? firstOf(chips(lines), (line) => (CHIP_TYPE.test(line) ? employmentOf(line) : undefined)),
    ...(firstOf(valuesOf(lines, PAY_LABEL), payIn) ?? firstOf(payLines, payIn) ?? {}),
    postedAt: firstOf(valuesOf(lines, POSTED_LABEL), (value) => dateOf(value, monthFirst)),
    requisitionId: firstOf(valuesOf(lines, ID_LABEL), (value) => idOf(value.split(/[\s|,;]+/)[0])) ?? (idLine ? idOf(idLine) : undefined),
  });
}

function definedOnly<T extends object>(details: T): T {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)) as T;
}
