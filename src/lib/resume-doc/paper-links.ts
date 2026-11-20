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

/** A plain address: no `?`, `&`, `,` or `%`, so nothing can turn into mailto options (a hidden `?bcc=`). */
const EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

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

/** National number lengths (without the trunk 0) per calling code, [shortest, longest]. */
const NATIONAL_LENGTH: Record<string, readonly [number, number]> = {
  "91": [10, 10], "44": [9, 10], "61": [9, 9], "49": [5, 11], "353": [7, 9], "65": [8, 8],
  "971": [8, 9], "92": [10, 10], "880": [10, 10], "64": [8, 10],
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
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== "0" ? `+${digits}` : null;
  }
  const code = callingCode(country);
  if (!code) return null;
  if (code === "1") {
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    return digits.length === 10 ? `+1${digits}` : null;
  }
  // Digits starting with the code: longer than any national number → the code is included ("91 98765 43210"); where
  // national numbers have one fixed length, as long as one → national ("9123456789" in India). Otherwise ("49 30 227-0"
  // in Germany) it could be either, so no link rather than a wrong one.
  const [shortest, longest] = NATIONAL_LENGTH[code] ?? [6, 12];
  if (digits.startsWith(code)) {
    const rest = digits.length - code.length;
    if (digits.length > longest) digits = digits.slice(code.length);
    else if (shortest !== longest && rest >= shortest) return null;
  } else if (digits.startsWith("0")) digits = digits.slice(1);
  const e164 = `${code}${digits}`;
  return digits.length >= 6 && e164.length <= 15 ? `+${e164}` : null;
}

/**
 * A phone → tel: in E.164; the printed text stays as the user typed it. With no country code to be had, no link: a
 * bare national number would dial differently from the reader's country.
 */
export function phoneLink(value: string, country = ""): PaperLink | null {
  const phone = value.trim();
  const e164 = toE164(phone, country);
  return e164 ? { href: `tel:${e164}`, label: phone, isExternal: false } : null;
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
  if (kind === "linkedin" && (host === "linkedin.com" || host.endsWith(".linkedin.com")) && first && second) label = `linkedin.com/${first}/${second}`;
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
