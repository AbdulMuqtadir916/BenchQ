import { polarity } from "./polarity";
import { canonical } from "./text";
import type { FieldOption } from "./types";

/** The candidate's right to work, read from their saved answers however they're worded, and the status sentence it
 * means on a form: "I am authorized to work in the U.S. but will require sponsorship". Status comes only from what they
 * saved about authorization and sponsorship, never from a visa type alone. */

export type WorkStatus = { authorized: boolean | null; needsSponsorship: boolean | null };

const NOT_AUTHORIZED = /\b(not (legally |currently |yet )?(authori[sz]ed|eligible|permitted)|unauthori[sz]ed|no (work )?(authori[sz]ation|permit|right to work))\b/;
/** Answers that hold a right to work without saying yes: "US Citizen", "Green card holder", "H-1B", "Authorized". */
const HOLDS_RIGHT = /\b(us citizen|citizen|green card|permanent resident|gc|ead|h 1b|h1b|h 4 ead|h4 ead|l 1|l1|tn|opt|cpt|e 3|o 1|authori[sz]ed|eligible)\b/;
const NO_SPONSORSHIP = /\b(not? (require|need)\w*|not (be )?(requir|need)\w*|no (sponsorship|visa)|without (any )?(visa )?sponsorship|dont need|do not need|wont need|will not need|doesnt require|does not require|not required|not needed|no need)\b/;
const NEEDS_SPONSORSHIP = /\b(requir\w*|need\w*|transfer\w*|sponsor\w*|petition)\b/;

/** Whether a saved answer to "Are you authorized to work in the US?" says yes: "Yes", "Yes - H1B", "Authorized", "US
 * Citizen", "Green card holder" are yes; "No", "Not authorized" are no. */
export function authorizedIn(answer: string): boolean | null {
  const text = canonical(answer);
  if (!text) return null;
  if (NOT_AUTHORIZED.test(text)) return false;
  const sign = polarity(answer);
  if (sign) return sign === "yes";
  return HOLDS_RIGHT.test(text) ? true : null;
}

/** Whether a saved answer to "Will you require sponsorship?" says yes: "Yes", "Yes, H-1B transfer", "Transfer only",
 * "Will need sponsorship" are yes; "No", "No sponsorship required", "Not needed" are no. A visa type alone says
 * neither. */
export function sponsorshipIn(answer: string): boolean | null {
  const text = canonical(answer);
  if (!text) return null;
  if (NO_SPONSORSHIP.test(text)) return false;
  const sign = polarity(answer);
  if (sign) return sign === "yes";
  return NEEDS_SPONSORSHIP.test(text) ? true : null;
}

/** What sponsorship an authorization answer mentions in words, like "Yes, but I need an H-1B transfer". */
export function sponsorshipWordsIn(answer: string): boolean | null {
  const text = canonical(answer);
  if (NO_SPONSORSHIP.test(text)) return false;
  return /\b(transfer\w*|sponsor\w*|petition)\b/.test(text) ? true : null;
}

/** The status a candidate's two saved answers come to, as words a status list's option can be matched with. Null when
 * they don't settle it. */
export function statusAnswer({ authorized, needsSponsorship }: WorkStatus): string | null {
  if (authorized === false) return "Not authorized to work in the US";
  if (authorized !== true || needsSponsorship === null) return null;
  return needsSponsorship
    ? "Authorized to work in the US, will require sponsorship"
    : "Authorized to work in the US for any employer, no sponsorship needed";
}

/** What a status sentence on a form says. A list about sponsorship alone ("Yes, I need sponsorship") isn't one. */
function statusOfOption(label: string): WorkStatus | null {
  const text = canonical(label);
  if (!/\b(authori[sz]ed|eligible|right to work|work permit)\b/.test(text)) return null;
  if (NOT_AUTHORIZED.test(text)) return { authorized: false, needsSponsorship: null };
  if (/\b(any employer|without (any )?(visa |employer |company )?sponsorship|no sponsorship)\b/.test(text) || NO_SPONSORSHIP.test(text)) {
    return { authorized: true, needsSponsorship: false };
  }
  if (NEEDS_SPONSORSHIP.test(text)) return { authorized: true, needsSponsorship: true };
  return { authorized: true, needsSponsorship: null };
}

/** The option of a status list an answer means, null when it doesn't settle it (the BDE picks), or undefined when the
 * list isn't one. Only an option that says the same about authorization and sponsorship fits. */
export function statusOptionFor(answer: string, options: FieldOption[]): string | null | undefined {
  const statuses = options.flatMap((option) => {
    const status = statusOfOption(option.label);
    return status ? [{ option, status }] : [];
  });
  if (statuses.length < 2 || !statuses.some(({ status }) => status.needsSponsorship !== null)) return undefined;
  // One answer's yes is about authorization: sponsorship counts only when it's said in words.
  const wanted: WorkStatus = { authorized: authorizedIn(answer), needsSponsorship: sponsorshipWordsIn(answer) };
  if (wanted.authorized === null) return undefined;
  const fits = statuses.filter(({ status }) => status.authorized === wanted.authorized
    && (wanted.authorized === false || status.needsSponsorship === wanted.needsSponsorship));
  return fits.length === 1 ? fits[0]!.option.id : null;
}
