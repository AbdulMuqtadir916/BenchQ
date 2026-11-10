// SPDX-License-Identifier: MIT
/**
 * FieldType: canonical semantic field identities for ATS form autofill.
 *
 * Layered after Mozilla's `autocomplete` baseline for identity/contact/address
 * fields, then extended with ATS-specific types for professional links,
 * file uploads, EEO/demographic fields (opt-in only), consents, and
 * open-ended questions. The taxonomy is intentionally closed so the
 * classifier cannot accidentally invent a new type at runtime.
 */
export type FieldType =
  // Identity
  | 'first-name'
  | 'last-name'
  | 'full-name'
  | 'middle-name'
  | 'preferred-name'
  // Contact
  | 'email'
  | 'phone'
  // Address
  | 'address-line1'
  | 'address-line2'
  | 'address-city'
  | 'address-region'
  | 'address-country'
  | 'address-postal'
  // Documents
  | 'resume-upload'
  | 'cover-letter'
  | 'portfolio-upload'
  | 'transcript-upload'
  // Professional links
  | 'linkedin-url'
  | 'github-url'
  | 'website'
  | 'portfolio-url'
  // Employment
  | 'current-company'
  | 'current-title'
  | 'years-experience'
  // Authorization
  | 'work-authorization'
  | 'visa-sponsorship'
  // Compensation / availability
  | 'salary-expectation'
  | 'start-date'
  | 'relocation-willing'
  | 'remote-preference'
  // EEO / demographics (consent-gated)
  | 'eeo-gender'
  | 'eeo-race'
  | 'eeo-veteran'
  | 'eeo-disability'
  // Consents
  | 'consent-privacy'
  | 'consent-marketing'
  // Open-ended
  | 'open-ended-question'
  // Fallback
  | 'unknown';
