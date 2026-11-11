// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Original: https://searchfox.org/mozilla-central/source/toolkit/components/formautofill/
// Modifications: ported to TypeScript + standalone, 2026 Ebenezer Isaac

/**
 * Mozilla-derived field classifier.
 *
 * Pure function: takes a plain `FormField` snapshot (no DOM node reference)
 * and returns the highest-confidence `FieldType` match, the confidence score,
 * and the id of the rule that matched. Never throws; hostile input simply
 * returns `{ fieldType: undefined, confidence: 0, matchedRule: 'none' }`.
 *
 * Confidence tiers (picked so downstream fusion in B4 can prefer stronger
 * signals regardless of rule family):
 *   1.00  - `autocomplete` attribute token (HTML spec - the browser agrees).
 *   0.90  - HTML `type="email"` or `type="tel"` (native browser guarantee).
 *   0.80  - label text equals a canonical keyword (e.g. label is exactly
 *           "First Name" - strong natural-language signal).
 *   0.60  - label/ariaLabel/placeholder CONTAINS a keyword.
 *   0.40  - `name` or `id` attribute contains a keyword (developer naming).
 *   0.20  - placeholder hint only.
 *
 * The highest tier that fires wins. Ties (two rules at same tier) are
 * broken by rule declaration order which mirrors Firefox upstream.
 */

import type { FieldType } from '../../taxonomy/field-type';
import type { FormField } from '../../types/form-field';
import { canonicalize, normalize } from './normalize';
import { NAME_RULES } from './rules/names';
import type { NameRule } from './rules/names';
import { CONTACT_RULES } from './rules/contact';
import type { ContactRule } from './rules/contact';
import { ADDRESS_RULES } from './rules/address';
import type { AddressRule } from './rules/address';
import { EEO_RULES } from './rules/eeo';
import type { EeoRule } from './rules/eeo';

/** Shared rule shape across families - every rule file exposes this surface. */
type Rule = NameRule | ContactRule | AddressRule | EeoRule;

export interface ClassificationResult {
  /** undefined when no rule fired (confidence stays 0). */
  readonly fieldType?: FieldType;
  /** 0..1 inclusive. 0 means no match. */
  readonly confidence: number;
  /** Rule id for the winning match, or 'none' when nothing matched. */
  readonly matchedRule: string;
}

// --- Confidence tiers ------------------------------------------------------

export const CONFIDENCE_AUTOCOMPLETE = 1.0;
export const CONFIDENCE_HTML_TYPE = 0.9;
export const CONFIDENCE_LABEL_EXACT = 0.8;
export const CONFIDENCE_LABEL_CONTAINS = 0.6;
export const CONFIDENCE_ATTR_CONTAINS = 0.4;
export const CONFIDENCE_PLACEHOLDER = 0.2;

const NO_MATCH: ClassificationResult = Object.freeze({
  confidence: 0,
  matchedRule: 'none',
});

// --- Autocomplete whitelist -----------------------------------------------

/**
 * HTML `autocomplete` token to `FieldType`. Tokens pulled from WHATWG HTML
 * living standard §autofill and pruned to those our taxonomy models.
 */
const AUTOCOMPLETE_MAP: Readonly<Record<string, FieldType>> = Object.freeze({
  'given-name': 'first-name',
  'family-name': 'last-name',
  'additional-name': 'middle-name',
  'additional-name-initial': 'middle-name',
  'nickname': 'preferred-name',
  'name': 'full-name',
  'email': 'email',
  'tel': 'phone',
  'tel-national': 'phone',
  'address-line1': 'address-line1',
  'address-line2': 'address-line2',
  'address-level2': 'address-city',
  'address-level1': 'address-region',
  'postal-code': 'address-postal',
  'country': 'address-country',
  'country-name': 'address-country',
  'organization': 'current-company',
  'organization-title': 'current-title',
  'url': 'website',
});

// --- All rules (order = priority) -----------------------------------------

const ALL_RULES: ReadonlyArray<Rule> = [
  ...NAME_RULES,
  ...CONTACT_RULES,
  ...ADDRESS_RULES,
  ...EEO_RULES,
];

// --- Helpers --------------------------------------------------------------

function isExcluded(rule: Rule, blob: string): boolean {
  if (!rule.exclude) return false;
  return rule.exclude.test(blob);
}

function testAttr(rule: Rule, attrBlob: string): boolean {
  return attrBlob.length > 0 && rule.attr.test(attrBlob);
}

function testLabel(rule: Rule, labelBlob: string): boolean {
  return labelBlob.length > 0 && rule.label.test(labelBlob);
}

/**
 * Returns the canonical keyword set for a rule as a regex anchored to full
 * string. We approximate "label exact match" by running the same label
 * regex but with `^...$` anchors composed at call time. We avoid pre-
 * building a second regex per rule to keep the rule tables flat.
 */
function isLabelExact(rule: Rule, label: string): boolean {
  if (label.length === 0 || label.length > 64) return false;
  // Normalise whitespace and punctuation padding. Exact-match semantics:
  // the whole normalised label equals the keyword (ignoring leading/trailing
  // non-letter noise).
  const trimmed = label.replace(/^[\s:*?.()[\]]+|[\s:*?.()[\]]+$/g, '');
  if (trimmed.length === 0) return false;
  const re = rule.label;
  const m = trimmed.match(re);
  if (!m || m.index === undefined) return false;
  // match must span the whole trimmed string (modulo trailing / leading
  // word-boundary noise the regex itself tolerates).
  const start = m.index;
  const end = start + m[0].length;
  return start <= 1 && end >= trimmed.length - 1;
}

// --- Main entry -----------------------------------------------------------

/**
 * Classify a single form field using Mozilla-derived regex rules.
 *
 * Pure and deterministic. The same `FormField` input yields the same
 * `ClassificationResult` across calls.
 */
export function classifyFieldMozilla(field: FormField): ClassificationResult {
  if (!field) return NO_MATCH;

  // Tier 1: autocomplete attribute (spec-compliant fast path).
  const ac = normalize(field.autocomplete);
  if (ac.length > 0 && ac in AUTOCOMPLETE_MAP) {
    const fieldType = AUTOCOMPLETE_MAP[ac];
    if (fieldType !== undefined) {
      return {
        fieldType,
        confidence: CONFIDENCE_AUTOCOMPLETE,
        matchedRule: `mozilla/autocomplete/${ac}`,
      };
    }
  }

  // Tier 2: native HTML type for email / phone.
  if (field.htmlType === 'email') {
    return {
      fieldType: 'email',
      confidence: CONFIDENCE_HTML_TYPE,
      matchedRule: 'mozilla/html-type/email',
    };
  }
  if (field.htmlType === 'tel') {
    return {
      fieldType: 'phone',
      confidence: CONFIDENCE_HTML_TYPE,
      matchedRule: 'mozilla/html-type/tel',
    };
  }

  // Normalise every signal once.
  const label = canonicalize(field.label);
  const ariaLabel = canonicalize(field.ariaLabel);
  const placeholder = canonicalize(field.placeholder);
  const name = canonicalize(field.name);
  const id = canonicalize(field.id);

  // Combined blob for exclusion checks (any keyword anywhere kills the rule).
  const fullBlob = [label, ariaLabel, placeholder, name, id]
    .filter((s) => s.length > 0)
    .join(' ');

  // Run every rule and keep the highest-confidence match. Ties broken by
  // declaration order (first rule to hit that tier wins).
  let best: ClassificationResult = NO_MATCH;

  for (const rule of ALL_RULES) {
    if (isExcluded(rule, fullBlob)) continue;

    // Tier 3: label exact match.
    if (isLabelExact(rule, label) || isLabelExact(rule, ariaLabel)) {
      if (CONFIDENCE_LABEL_EXACT > best.confidence) {
        best = {
          fieldType: rule.fieldType,
          confidence: CONFIDENCE_LABEL_EXACT,
          matchedRule: rule.id,
        };
      }
      continue;
    }

    // Tier 4: label / ariaLabel contains keyword.
    if (testLabel(rule, label) || testLabel(rule, ariaLabel)) {
      if (CONFIDENCE_LABEL_CONTAINS > best.confidence) {
        best = {
          fieldType: rule.fieldType,
          confidence: CONFIDENCE_LABEL_CONTAINS,
          matchedRule: rule.id,
        };
      }
      continue;
    }

    // Tier 5: name or id attribute contains keyword.
    if (testAttr(rule, name) || testAttr(rule, id)) {
      if (CONFIDENCE_ATTR_CONTAINS > best.confidence) {
        best = {
          fieldType: rule.fieldType,
          confidence: CONFIDENCE_ATTR_CONTAINS,
          matchedRule: rule.id,
        };
      }
      continue;
    }

    // Tier 6: placeholder contains keyword.
    if (testLabel(rule, placeholder)) {
      if (CONFIDENCE_PLACEHOLDER > best.confidence) {
        best = {
          fieldType: rule.fieldType,
          confidence: CONFIDENCE_PLACEHOLDER,
          matchedRule: rule.id,
        };
      }
      continue;
    }
  }

  return best;
}
