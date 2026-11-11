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

export function neverFillReason(field: ScannedField): string | null {
  if (field.kind === "password") return "Password";
  if (field.kind === "file") return "File upload";
  if (field.inAccountForm) return "Account sign-in or sign-up form";
  const text = normalize(`${field.label} ${field.hints.replace(/([a-z])([A-Z])/g, "$1 $2")}`)
    .replace(PROFILE_HANDLE, "$1 profile").replace(AS_ON_DOCUMENT, " ");
  const asksWhether = ASKS_WHETHER.test(text) && !DOCUMENT_DETAIL.test(text);
  return RULES.find(({ reason, pattern }) => !(asksWhether && reason === GOVERNMENT) && pattern.test(text))?.reason ?? null;
}
