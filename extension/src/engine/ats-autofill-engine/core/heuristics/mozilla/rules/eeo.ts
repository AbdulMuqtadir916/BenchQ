// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Original: https://searchfox.org/mozilla-central/source/toolkit/components/formautofill/
// Modifications: ported to TypeScript + standalone, 2026 Ebenezer Isaac

/**
 * Voluntary self-identification (EEO) rules: gender, race/ethnicity, veteran
 * status, disability status. These are US-centric fields mandated by OFCCP
 * for federal contractors and widely reused on ATS platforms.
 *
 * Mozilla upstream does NOT ship EEO keywords - these are an ATS-specific
 * extension layered on top of the Mozilla rule structure. The file lives in
 * the mozilla/ subtree because it shares the same pure-regex matching style
 * and MPL-2.0 header boundary; keeping it here means one MPL wall around
 * every rule table in the classifier.
 *
 * Hard rule from B2: EEO fields are gated behind explicit user consent in
 * the plan-builder. The classifier only TAGS them; it never auto-fills them.
 */

import type { FieldType } from '../../../taxonomy/field-type';

export interface EeoRule {
  readonly id: string;
  readonly fieldType: FieldType;
  readonly attr: RegExp;
  readonly label: RegExp;
  readonly exclude?: RegExp;
}

// --- Gender ---------------------------------------------------------------

const GENDER_ATTR = /(?:^|[_\-\s.[])(?:gender|sex|gender_identity|gender_identification)/i;
const GENDER_LABEL =
  /(?:\bgender\b|\bsex\b|\bgender[\s._-]*identity\b|\bhow[\s._-]*do[\s._-]*you[\s._-]*identify\b|\bpreferred[\s._-]*pronoun)/i;

// --- Race / Ethnicity -----------------------------------------------------

const RACE_ATTR = /(?:^|[_\-\s.[])(?:race|ethnicity|ethnic_group|ethnic_origin|hispanic|race_ethnicity)/i;
const RACE_LABEL =
  /(?:\brace\b|\bethnicity\b|\bethnic[\s._-]*(?:group|origin|background)\b|\bhispanic(?:[\s._-]*or[\s._-]*latino)?\b|\brace[\s._-]*\/[\s._-]*ethnicity\b|\brace[\s._-]*or[\s._-]*ethnicity\b)/i;

// --- Veteran status -------------------------------------------------------

const VETERAN_ATTR = /(?:^|[_\-\s.[])(?:veteran(?:_status)?|protected_veteran|military_status|armed_forces_status|vets_status)/i;
const VETERAN_LABEL =
  /(?:\bveteran(?:[\s._-]*status)?\b|\bprotected[\s._-]*veteran\b|\bmilitary[\s._-]*(?:status|service)\b|\barmed[\s._-]*forces\b|\bvevraa\b|\bself[\s._-]*identif(?:y|ication)[\s._-]*(?:as[\s._-]*a[\s._-]*)?veteran)/i;

// --- Disability status ----------------------------------------------------

const DISABILITY_ATTR = /(?:^|[_\-\s.[])(?:disability(?:_status)?|disabled|ada_status|section_503|disability_self_id)/i;
const DISABILITY_LABEL =
  /(?:\bdisability(?:[\s._-]*status)?\b|\bdisabled\b|\bsection[\s._-]*503\b|\bada[\s._-]*(?:status|disclosure)\b|\bself[\s._-]*identif(?:y|ication)[\s._-]*(?:of[\s._-]*)?disability\b|\bvoluntary[\s._-]*self[\s._-]*identification)/i;

/**
 * EEO rules evaluated in declaration order.
 */
export const EEO_RULES: ReadonlyArray<EeoRule> = [
  {
    id: 'mozilla/eeo/gender',
    fieldType: 'eeo-gender',
    attr: GENDER_ATTR,
    label: GENDER_LABEL,
  },
  {
    id: 'mozilla/eeo/race',
    fieldType: 'eeo-race',
    attr: RACE_ATTR,
    label: RACE_LABEL,
  },
  {
    id: 'mozilla/eeo/veteran',
    fieldType: 'eeo-veteran',
    attr: VETERAN_ATTR,
    label: VETERAN_LABEL,
  },
  {
    id: 'mozilla/eeo/disability',
    fieldType: 'eeo-disability',
    attr: DISABILITY_ATTR,
    label: DISABILITY_LABEL,
  },
];
