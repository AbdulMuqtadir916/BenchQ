// SPDX-License-Identifier: MIT
/**
 * ATS-vendor-specific classification overlays.
 *
 * These rules take precedence over the Mozilla heuristics because vendor
 * attributes encode intent with near-zero ambiguity. Patterns use bounded
 * character classes and no `.*` / `.+`, so catastrophic backtracking is
 * impossible even on 10KB hostile input.
 */
import type { FieldType } from '../taxonomy/field-type';
import type { FormField } from '../types/form-field';

type AtsKind = 'greenhouse' | 'lever' | 'workday';

interface AtsRule {
  readonly fieldType: FieldType;
  readonly pattern: RegExp;
  /** Which FormField property to test. */
  readonly on: 'name' | 'id';
}

/**
 * Greenhouse rules. Greenhouse application forms use a consistent
 * `job_application[<field_name>]` naming convention for standard fields and
 * a numeric `question_NNNN` pattern for custom questions. The numeric
 * questions are deliberately NOT classified here so they fall through to
 * Mozilla heuristics or land as `unknown`.
 */
const GREENHOUSE_RULES: ReadonlyArray<AtsRule> = [
  { on: 'name', fieldType: 'first-name',     pattern: /^job_application\[first_name\]$/u },
  { on: 'name', fieldType: 'last-name',      pattern: /^job_application\[last_name\]$/u },
  { on: 'name', fieldType: 'email',          pattern: /^job_application\[email\]$/u },
  { on: 'name', fieldType: 'phone',          pattern: /^job_application\[phone\]$/u },
  { on: 'name', fieldType: 'resume-upload',  pattern: /^job_application\[resume\]$/u },
  { on: 'name', fieldType: 'cover-letter',   pattern: /^job_application\[cover_letter\]$/u },
  { on: 'name', fieldType: 'linkedin-url',   pattern: /^job_application\[urls\]\[LinkedIn\]$/u },
  { on: 'name', fieldType: 'github-url',     pattern: /^job_application\[urls\]\[GitHub\]$/u },
  { on: 'name', fieldType: 'portfolio-url',  pattern: /^job_application\[urls\]\[Portfolio\]$/u },
  { on: 'name', fieldType: 'website',        pattern: /^job_application\[urls\]\[Website\]$/u },
];

/**
 * Lever rules, for the natural field names on postings.lever.co.
 */
const LEVER_RULES: ReadonlyArray<AtsRule> = [
  // Production Lever DOM shape (natural names + bracketed urls[...]).
  // Verified against tests/harness/fixtures/lever/stripe-pe.html and
  // andrewmillercode/Autofill-Jobs fields.lever map (investigation file 59).
  { on: 'name', fieldType: 'full-name',       pattern: /^name$/u },
  { on: 'name', fieldType: 'first-name',      pattern: /^(?:firstName|first_name)$/u },
  { on: 'name', fieldType: 'last-name',       pattern: /^(?:lastName|last_name)$/u },
  { on: 'name', fieldType: 'email',           pattern: /^email$/u },
  { on: 'name', fieldType: 'phone',           pattern: /^phone$/u },
  { on: 'name', fieldType: 'current-company', pattern: /^(?:org|company|employer)$/u },
  { on: 'name', fieldType: 'current-title',   pattern: /^(?:title|position)$/u },
  { on: 'name', fieldType: 'address-city',    pattern: /^location$/u },
  { on: 'name', fieldType: 'resume-upload',   pattern: /^resume$/u },
  { on: 'name', fieldType: 'linkedin-url',    pattern: /^urls\[(?:LinkedIn|Linkedin|linkedin)\]$/u },
  { on: 'name', fieldType: 'github-url',      pattern: /^urls\[(?:GitHub|Github|github)\]$/u },
  { on: 'name', fieldType: 'portfolio-url',   pattern: /^urls\[(?:Portfolio|portfolio)\]$/u },
  { on: 'name', fieldType: 'website',         pattern: /^urls\[(?:Twitter|X)\]$/u },
  { on: 'name', fieldType: 'website',         pattern: /^urls\[(?:Other|Website|website)\]$/u },
  // Open-ended custom questions. Lever stores them as cards[N][answer].
  { on: 'name', fieldType: 'open-ended-question', pattern: /^cards\[[0-9]+\]\[answer\]$/u },
];

/**
 * Workday rules. Workday surfaces machine-stable field identifiers via
 * `data-automation-id`; the scanner mirrors the automation id into
 * FormField.id. Workday uses hyphenated PascalCase tokens.
 */
const WORKDAY_RULES: ReadonlyArray<AtsRule> = [
  { on: 'id', fieldType: 'first-name',      pattern: /^legalNameSection_firstName$/u },
  { on: 'id', fieldType: 'last-name',       pattern: /^legalNameSection_lastName$/u },
  { on: 'id', fieldType: 'email',           pattern: /^(?:contact|email)(?:Information)?_email(?:Address)?$/u },
  { on: 'id', fieldType: 'phone',           pattern: /^(?:contact|phone)(?:Information)?_phoneNumber$/u },
  { on: 'id', fieldType: 'phone',           pattern: /^phone_phoneNumber$/u },
  { on: 'id', fieldType: 'resume-upload',   pattern: /^(?:resume|file)_upload$/u },
  { on: 'id', fieldType: 'address-line1',   pattern: /^address_addressLine1$/u },
  { on: 'id', fieldType: 'address-line2',   pattern: /^address_addressLine2$/u },
  { on: 'id', fieldType: 'address-city',    pattern: /^address_city$/u },
  { on: 'id', fieldType: 'address-region',  pattern: /^address_countryRegion$/u },
  { on: 'id', fieldType: 'address-postal',  pattern: /^address_postalCode$/u },
  { on: 'id', fieldType: 'address-country', pattern: /^address_country$/u },
];

const VENDOR_TABLE: Readonly<Record<AtsKind, ReadonlyArray<AtsRule>>> = {
  greenhouse: GREENHOUSE_RULES,
  lever: LEVER_RULES,
  workday: WORKDAY_RULES,
};

function vendorOf(url: string): AtsKind | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (host.endsWith('greenhouse.io')) return 'greenhouse';
  if (host.endsWith('lever.co')) return 'lever';
  if (host.endsWith('myworkdayjobs.com') || host.endsWith('workday.com')) return 'workday';
  return undefined;
}

/** What the site's own field names say a field is, or null. Pure. Never throws. */
export function classifyFieldAts(field: FormField, url: string): FieldType | null {
  const vendor = vendorOf(url);
  const rules = vendor ? VENDOR_TABLE[vendor] : [];
  return rules.find(({ on, pattern }) => pattern.test(field[on] ?? ''))?.fieldType ?? null;
}
