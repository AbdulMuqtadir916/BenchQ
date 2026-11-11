// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Original: https://searchfox.org/mozilla-central/source/toolkit/components/formautofill/
// Modifications: ported to TypeScript + standalone, 2026 Ebenezer Isaac

/**
 * Contact rules: email / phone.
 *
 * Keywords ported from Firefox `HeuristicsRegExp.sys.mjs` RULES.email and
 * RULES.tel. Covers en/fr/es/de/it/ja/ru/zh/ko.
 */

import type { FieldType } from '../../../taxonomy/field-type';

export interface ContactRule {
  readonly id: string;
  readonly fieldType: FieldType;
  readonly attr: RegExp;
  readonly label: RegExp;
  readonly exclude?: RegExp;
}

// --- Email ----------------------------------------------------------------

const EMAIL_ATTR = /(?:^|[_\-\s.[])(?:e[_\-\s.]?mail|email_address|emailaddress|user_email|contact_email|primary_email|work_email|personal_email)/i;
const EMAIL_LABEL =
  /(?:\be[\s._-]?mail(?:[\s._-]*address)?\b|\bcourriel\b|\bcorreo(?:[\s._-]*electr[oó]nico)?\b|メール|邮件|이메일|\bЭлектронная[\s._-]*почта\b)/iu;
// Exclude "mailing address" specifically (word-start mail, not e-mail).
// Pattern: start-of-string or non-'e'/'-' char before "mail" + address word.
const EMAIL_EXCLUDE = /(?:^|[^a-z-])mail(?:ing)?[\s._-]*(?:address|street|code|zip|city)|\bpostal[\s._-]*mail\b/i;

// --- Phone ----------------------------------------------------------------

const PHONE_ATTR = /(?:^|[_\-\s.[])(?:phone|tel|telephone|mobile|cell(?:phone)?|fax|contact_number|phonenumber|phone_number|mobile_number|work_phone|home_phone|primary_phone)/i;
const PHONE_LABEL =
  /(?:\bphone(?:[\s._-]*number)?\b|\btelephone\b|\bmobile(?:[\s._-]*number)?\b|\bcell(?:[\s._-]*phone)?\b|\bfax\b|\bt[eé]l[eé]phone\b|\btel[eé]fono\b|\btelefon\b|電話|전화|\bТелефон\b)/iu;

/**
 * Contact rules evaluated in declaration order.
 */
export const CONTACT_RULES: ReadonlyArray<ContactRule> = [
  {
    id: 'mozilla/contact/email',
    fieldType: 'email',
    attr: EMAIL_ATTR,
    label: EMAIL_LABEL,
    exclude: EMAIL_EXCLUDE,
  },
  {
    id: 'mozilla/contact/phone',
    fieldType: 'phone',
    attr: PHONE_ATTR,
    label: PHONE_LABEL,
  },
];
