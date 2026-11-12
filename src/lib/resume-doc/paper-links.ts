/**
 * Links printed on the résumé: email → mailto:, phone → tel:, profile and project URLs → https. Each gets a short
 * label for the page ("linkedin.com/in/asha", "GitHub", "Live demo") so long URLs don't crowd the line.
 * Null means the value isn't a usable link; the paper prints it as plain text.
 */
export interface PaperLink {
  href: string;
  label: string;
  /** Opens in a new tab (web links, not mailto: / tel:). */
  isExternal: boolean;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>".]+$/;

export function emailLink(value: string): PaperLink | null {
  const email = value.trim();
  if (!EMAIL.test(email)) return null;
  return { href: `mailto:${email}`, label: email, isExternal: false };
}

/** Calling codes by country, as a résumé's country field writes it (name, ISO 3166 alpha-2 or alpha-3; lower case). */
const CALLING_CODES: Record<string, string> = {
  "us": "1", "usa": "1", "united states": "1", "united states of america": "1", "america": "1",
  "ca": "1", "can": "1", "canada": "1",
  "in": "91", "ind": "91", "india": "91",
  "gb": "44", "gbr": "44", "uk": "44", "united kingdom": "44", "england": "44",
  "au": "61", "aus": "61", "australia": "61",
  "de": "49", "deu": "49", "germany": "49",
  "ie": "353", "irl": "353", "ireland": "353",
  "sg": "65", "sgp": "65", "singapore": "65",
  "ae": "971", "are": "971", "uae": "971", "united arab emirates": "971",
  "pk": "92", "pak": "92", "pakistan": "92",
  "bd": "880", "bgd": "880", "bangladesh": "880",
  "nz": "64", "nzl": "64", "new zealand": "64",
};

/** The calling code for a country field, or null when it isn't one we know. */
export function callingCode(country: string): string | null {
  return CALLING_CODES[country.trim().toLowerCase().replace(/\./g, "")] ?? null;
}

/**
 * A phone number in E.164 (`+<country code><number>`), or null. A number typed with `+` (or `00`) keeps its own
 * country code; otherwise the code comes from `country`, after dropping a national trunk `0` and a code the user
 * already typed without the `+`. Unknown country and no `+`: null, since a guess would dial the wrong place.
 */
export function toE164(value: string, country: string): string | null {
  const phone = value.trim();
  if (!phone || /[^\d\s()+.\-/]/.test(phone)) return null;
  let digits = phone.replace(/\D/g, "");
  if (phone.startsWith("+") || phone.startsWith("00")) {
    if (phone.startsWith("00")) digits = digits.slice(2);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const code = callingCode(country);
  if (!code) return null;
  if (code === "1") {
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    return digits.length === 10 ? `+1${digits}` : null;
  }
  if (digits.startsWith(code) && digits.length - code.length >= 8) digits = digits.slice(code.length);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  const e164 = `${code}${digits}`;
  return digits.length >= 6 && e164.length <= 15 ? `+${e164}` : null;
}

/**
 * A phone → tel: in E.164; the printed text stays as the user typed it. With no country code to be had, the bare
 * digits still dial within the candidate's own country.
 */
export function phoneLink(value: string, country = ""): PaperLink | null {
  const phone = value.trim();
  const digits = phone.replace(/\D/g, "");
  const dial = toE164(phone, country) ?? (/^[\d\s().\-/]+$/.test(phone) && digits.length >= 7 && digits.length <= 15 ? digits : null);
  return dial ? { href: `tel:${dial}`, label: phone, isExternal: false } : null;
}

/** An https URL: `https://` added when the scheme is missing, and `http://` upgraded. */
export function webUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(withScheme)) return null;
  const url = new URL(withScheme);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.protocol = "https:";
  if (!url.hostname.includes(".")) return null;
  return url;
}

const hostOf = (url: URL) => url.hostname.replace(/^www\./i, "").toLowerCase();
const pathParts = (url: URL) => url.pathname.split("/").filter(Boolean);
const shortUrl = (url: URL) => `${hostOf(url)}${url.pathname.replace(/\/+$/, "")}`;

/** LinkedIn → "linkedin.com/in/<handle>", GitHub → "github.com/<handle>": readable on paper, short on the line. */
export function profileLink(kind: "linkedin" | "github", value: string): PaperLink | null {
  const url = webUrl(value);
  if (!url) return null;
  const host = hostOf(url);
  const [first, second] = pathParts(url);
  let label = shortUrl(url);
  if (kind === "linkedin" && host.endsWith("linkedin.com") && first && second) label = `linkedin.com/${first}/${second}`;
  if (kind === "github" && host === "github.com" && first) label = `github.com/${first}`;
  return { href: url.href, label, isExternal: true };
}

/**
 * A project's link, labelled so it means something on paper and in ATS text: "github.com/<owner>/<repo>" for a
 * repository, the bare domain ("clipgenie-5wrj.onrender.com") for anything else.
 */
export function projectLink(value: string): PaperLink | null {
  const url = webUrl(value);
  if (!url) return null;
  const [owner, repo] = pathParts(url);
  const label = hostOf(url) === "github.com" && owner ? ["github.com", owner, repo].filter(Boolean).join("/") : hostOf(url);
  return { href: url.href, label, isExternal: true };
}
