// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Original: https://searchfox.org/mozilla-central/source/toolkit/components/formautofill/
// Modifications: ported to TypeScript + standalone, 2026 Ebenezer Isaac

/**
 * Name rules: first-name / middle-name / last-name / full-name / preferred-name.
 *
 * Keywords ported from Firefox `HeuristicsRegExp.sys.mjs` RULES["given-name"],
 * RULES["family-name"], RULES["additional-name"], RULES["name"]. The original
 * patterns cover en/es/fr/de/it/nl/pt/pl/tr/ru/ja/zh/ko; we keep the same
 * coverage here.
 */

import type { FieldType } from '../../../taxonomy/field-type';

/**
 * One compiled rule that projects onto a canonical `FieldType` and carries
 * an id the classifier surfaces as `matchedRule`.
 */
export interface NameRule {
  readonly id: string;
  readonly fieldType: FieldType;
  /** Matches against name/id (stable attribute identifiers). */
  readonly attr: RegExp;
  /** Matches against label/placeholder/ariaLabel (natural language). */
  readonly label: RegExp;
  /**
   * Exclusionary pattern: if this matches the input, the rule is suppressed.
   * Used to keep `first name` from triggering the `name` full-name rule.
   */
  readonly exclude?: RegExp;
}

// --- First name -----------------------------------------------------------

const FIRST_NAME_ATTR = /(?:^|[_\-\s.[])(?:first|given|fore)[_\-\s.\]]*name|fname|firstname|givenname|f_name/i;
const FIRST_NAME_LABEL =
  /(?:\bfirst[\s._-]*name\b|\bgiven[\s._-]*name\b|\bforename\b|\bprenom\b|\bpr[eé]nom\b|\bnombre\b|\bnome\b|\bvorname\b|\bимя\b|(?<![氏姓])名(?!前)|이름)/iu;

// --- Last name ------------------------------------------------------------

const LAST_NAME_ATTR = /(?:^|[_\-\s.[])(?:last|family|sur)[_\-\s.\]]*name|lname|lastname|surname|familyname|l_name/i;
const LAST_NAME_LABEL =
  /(?:\blast[\s._-]*name\b|\bfamily[\s._-]*name\b|\bsurname\b|\bapellido\b|\bnachname\b|\bcognome\b|\bфамилия\b|姓(?!名)|성(?![a-z])|nom(?:[\s._-]+de[\s._-]+famille)?)/iu;

// --- Middle name ----------------------------------------------------------

const MIDDLE_NAME_ATTR = /(?:^|[_\-\s.[])(?:middle|additional|mid)[_\-\s.\]]*(?:name|initial)|mname|middlename|middleinitial|m_name/i;
const MIDDLE_NAME_LABEL =
  /(?:\bmiddle[\s._-]*(?:name|initial)\b|\badditional[\s._-]*name\b|\bsecond[\s._-]*name\b|\binitial\b|\bsegundo[\s._-]*nombre\b)/i;

// --- Full name ------------------------------------------------------------
// Matches plain "name" only when first/last/middle are not also present.

const FULL_NAME_ATTR = /(?:^|[_\-\s.[])(?:full[_\-\s.\]]*name|your[_\-\s.\]]*name|applicant[_\-\s.\]]*name|legal[_\-\s.\]]*name|\bname\b)/i;
const FULL_NAME_LABEL =
  /(?:\bfull[\s._-]*name\b|\byour[\s._-]*name\b|\bcomplete[\s._-]*name\b|\blegal[\s._-]*name\b|\bnombre[\s._-]*completo\b|\bnom[\s._-]*complet\b|\bvollst[aä]ndiger[\s._-]*name\b|\bname\b(?!\s*(?:of|\(|[:]))|氏名|姓名)/iu;
// Exclude first/middle/last composite labels from matching "name" alone.
const FULL_NAME_EXCLUDE = /(?:first|last|family|middle|given|sur|fore|additional|user|file|host|company|organi[sz]ation|employer|job|project|event|display|screen|pet|child|parent|emergency[\s._-]*contact)[\s._-]*name|\bname[\s._-]*of\b/i;

// --- Preferred name -------------------------------------------------------

const PREFERRED_NAME_ATTR = /(?:^|[_\-\s.[])(?:preferred|nick|display|common|chosen)[_\-\s.\]]*name|preferredname|nickname|displayname/i;
const PREFERRED_NAME_LABEL =
  /(?:\bpreferred[\s._-]*name\b|\bnickname\b|\bdisplay[\s._-]*name\b|\bcommon[\s._-]*name\b|\bwhat[\s._-]*(?:should|do|would)[\s._-]*we[\s._-]*call[\s._-]*you\b|\bhow[\s._-]*(?:do|should)[\s._-]*we[\s._-]*address[\s._-]*you\b|\bchosen[\s._-]*name\b)/i;

/**
 * Rules evaluated in declaration order; first match wins per signal-field tier.
 * Order: most-specific (first/last/middle/preferred) before the looser
 * full-name rule which has an exclusion guard.
 */
export const NAME_RULES: ReadonlyArray<NameRule> = [
  {
    id: 'mozilla/name/given-name',
    fieldType: 'first-name',
    attr: FIRST_NAME_ATTR,
    label: FIRST_NAME_LABEL,
  },
  {
    id: 'mozilla/name/family-name',
    fieldType: 'last-name',
    attr: LAST_NAME_ATTR,
    label: LAST_NAME_LABEL,
  },
  {
    id: 'mozilla/name/additional-name',
    fieldType: 'middle-name',
    attr: MIDDLE_NAME_ATTR,
    label: MIDDLE_NAME_LABEL,
  },
  {
    id: 'mozilla/name/preferred-name',
    fieldType: 'preferred-name',
    attr: PREFERRED_NAME_ATTR,
    label: PREFERRED_NAME_LABEL,
  },
  {
    id: 'mozilla/name/full-name',
    fieldType: 'full-name',
    attr: FULL_NAME_ATTR,
    label: FULL_NAME_LABEL,
    exclude: FULL_NAME_EXCLUDE,
  },
];
