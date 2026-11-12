import type { ScannedField } from "./types";
import { normalize } from "./text";

const GOVERNMENT = "Government or tax ID";

/** What autofill never touches, whatever the bank holds. */
const RULES: { reason: string; pattern: RegExp }[] = [
  { reason: "CAPTCHA", pattern: /\b(re ?captcha|hcaptcha|captcha|verify you are human|i am not a robot)\b/ },
  { reason: "Date of birth or age", pattern: /\b(date of birth|dob|birth ?date|birthday|your age|age range|current age|how old)\b/ },
  { reason: "Place of birth", pattern: /\b((place|city|country|state|town|county) of birth|birth ?(place|country|city)|born in|where were you born|country of origin)\b/ },
  { reason: GOVERNMENT, pattern: /\b(ssn|social security|passport|national (id|identity|insurance)|drivers? licen[cs]e|tax (id|number)|tin|ein|itin|aadhaar|aadhar|pan (card|number)|alien (registration )?number|uscis number|i 94|visa number)\b/ },
  { reason: "Payment details", pattern: /\b(credit card|debit card|card number|cvv|cvc|iban|routing number|bank account|account number|sort code)\b/ },
  { reason: "Account details", pattern: /\b(password|passcode|username|user name|user id|log ?in|sign in|security (question|answer)|verification code|one time (code|password)|otp|(security|account|atm|card|bank|secret|login|access) pin|pin (number|no))\b/ },
  // "Tax terms" and "Employment terms (W2/C2C)" are questions; terms someone agrees to aren't.
  { reason: "Consent or legal statement", pattern: /\b(i (hereby )?(agree|accept|consent|acknowledge|certify|attest|declare|understand|confirm|authori[sz]e)|terms (and|&) conditions|terms of (service|use)|(agree|accept|consent)\b.*\bterms|terms\b.*\b(agree|accept)|privacy (policy|notice|statement)|gdpr|consent|acknowledg\w*)\b/ },
  { reason: "Signature", pattern: /\b(signature|e sign|esign|sign here|digitally sign|initials)\b/ },
];

/** A user name on a profile site is no sign-in: "GitHub username". */
const PROFILE_HANDLE = /\b(github|gitlab|bitbucket|leetcode|hackerrank|codechef|codeforces|kaggle|stack ?overflow|twitter|skype|telegram|slack|discord|behance|dribbble|medium|instagram|linkedin) (user ?name|handle|user id)\b/g;
/** "Full legal name (as on passport)" asks for a name. */
const AS_ON_DOCUMENT = /\bas (it )?(appears |written |shown |printed |listed )?(on|in|per) (your |the )?(passport|government id|id|visa|licen[cs]e)\b/g;
/** "Do you have a valid driver's license?" asks whether, not for the number. */
const ASKS_WHETHER = /^(do|does|are|have|has|will|can|would) you\b.*\b(have|hold|possess|own|carry|valid|eligible|able to (obtain|get))\b/;
const DOCUMENT_DETAIL = /\b(number|no|expir\w*|issu\w*|state of|class|copy|upload|details?|scan)\b/;

/** Left to the BDE, but still kept in the form saved with an application: an upload's file name and a ticked consent. */
const KEPT_REASONS = new Set(["File upload", "Consent or legal statement"]);

export const staysOutOfSavedForm = (reason: string) => !KEPT_REASONS.has(reason);

/** A US Social Security number written in groups (123-45-6789, 123 45 6789), or alone as nine digits, never one the
 * SSA doesn't issue (000, 666 or 9xx first; 00 or 0000 after). */
const SSN_WRITTEN = /\b(?!000|666|9\d\d)\d{3}([- ])(?!00)\d{2}\1(?!0000)\d{4}\b/;
const SSN_ALONE = /^(?!000|666|9\d\d)\d{3}(?!00)\d{2}(?!0000)\d{4}$/;
/** A nine-digit SSN inside running text ("My SSN is 123456789"): a word of its own, not part of a link, a name or a
 * longer run of digits (linkedin.com/in/ravi-123456789). */
const SSN_IN_TEXT = /(?<![\w/.-])(?!000|666|9\d\d)\d{3}(?!00)\d{2}(?!0000)\d{4}(?![\w/-]|\.\w)/;
/** A run of 13 to 19 digits, spaced or dashed as a card number is written. */
const CARD_DIGITS = /\b(?:\d[ -]?){12,18}\d\b/g;

/** The check every payment card number passes (Luhn). */
function passesCardCheck(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[digits.length - 1 - index]);
    sum += index % 2 === 1 ? (digit * 2 > 9 ? digit * 2 - 9 : digit * 2) : digit;
  }
  return sum % 10 === 0;
}

/** Whether a value holds a US Social Security number or a payment card's number, whatever its field is called. The
 * rules above go by the label, so this keeps one typed into a field they don't name ("ID number", "Notes") out of the
 * form saved with an application too. A long number that happens to pass the card check stays out with them. */
export function holdsSensitiveNumber(value: string): boolean {
  const text = value.trim();
  if (SSN_WRITTEN.test(text) || SSN_ALONE.test(text) || SSN_IN_TEXT.test(text)) return true;
  return (text.match(CARD_DIGITS) ?? []).some((run) => passesCardCheck(run.replace(/\D/g, "")));
}

export function neverFillReason(field: ScannedField): string | null {
  if (field.kind === "password") return "Password";
  if (field.kind === "file") return "File upload";
  if (field.inAccountForm) return "Account sign-in or sign-up form";
  const text = normalize(`${field.label} ${field.hints.replace(/([a-z])([A-Z])/g, "$1 $2")}`)
    .replace(PROFILE_HANDLE, "$1 profile").replace(AS_ON_DOCUMENT, " ");
  const asksWhether = ASKS_WHETHER.test(text) && !DOCUMENT_DETAIL.test(text);
  return RULES.find(({ reason, pattern }) => !(asksWhether && reason === GOVERNMENT) && pattern.test(text))?.reason ?? null;
}
