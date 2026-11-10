// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Original: https://searchfox.org/mozilla-central/source/toolkit/components/formautofill/
// Modifications: ported to TypeScript + standalone, 2026 Ebenezer Isaac

/**
 * Address rules: address-line1 / address-line2 / city / region / country /
 * postal.
 *
 * Keywords ported from Firefox `HeuristicsRegExp.sys.mjs` RULES for
 * street-address, address-line1, address-line2, address-level1 (state/region),
 * address-level2 (city), postal-code, country.
 */

import type { FieldType } from '../../../taxonomy/field-type';

export interface AddressRule {
  readonly id: string;
  readonly fieldType: FieldType;
  readonly attr: RegExp;
  readonly label: RegExp;
  readonly exclude?: RegExp;
}

// --- Line 2 (evaluated before line 1 so `addressLine2` does not collapse
//     onto the more generic line-1 rule) ------------------------------------

const LINE2_ATTR = /(?:^|[_\-\s.[])(?:address[_\-\s.]*line[_\-\s.]*2|addr2|address2|street[_\-\s.]*line[_\-\s.]*2|apt|apartment|suite|unit[_\-\s.]*number)/i;
const LINE2_LABEL =
  /(?:\baddress[\s._-]*line[\s._-]*2\b|\bstreet[\s._-]*line[\s._-]*2\b|\bline[\s._-]*2\b|\baddr[\s._-]*2\b|\bapt\.?\b|\bapartment\b|\bsuite\b|\bunit\b|\bfloor\b|\bbuilding\b)/i;

// --- Line 1 ---------------------------------------------------------------

const LINE1_ATTR = /(?:^|[_\-\s.[])(?:street[_\-\s.]*address|street[_\-\s.]*line[_\-\s.]*1|address[_\-\s.]*line[_\-\s.]*1|addr1|address1|street_name|street$|address$|address_1|addrline1|addressline1|home_address|mailing_address)/i;
const LINE1_LABEL =
  /(?:\bstreet[\s._-]*address\b|\baddress[\s._-]*line[\s._-]*1\b|\bline[\s._-]*1\b|\baddr[\s._-]*1\b|\b(?:home|mailing|residential|street)[\s._-]*address\b|\badresse\b|\bdirecci[oó]n\b|\bindirizzo\b|\bstra[sß]e\b|住所)/iu;
// Avoid false-hit on "email address", "ip address" when only the word
// "address" appears.
const LINE1_EXCLUDE = /(?:e[\s._-]?mail|ip|web|url|business|company|office|shipping|billing)[\s._-]*address(?:[\s._-]*(?:line)?[\s._-]*[23])?/i;

// --- City (address-level2) ------------------------------------------------

const CITY_ATTR = /(?:^|[_\-\s.[])(?:city|town|locality|municipality|ville)/i;
const CITY_LABEL =
  /(?:\bcity\b|\btown\b|\blocality\b|\bmunicipality\b|\bville\b|\bciudad\b|\bcitt[aà]\b|\bstadt\b|\blocalit[aà]\b|市|\bгород\b|\b도시\b)/iu;

// --- Region (address-level1: state/province/region) -----------------------

const REGION_ATTR = /(?:^|[_\-\s.[])(?:state|province|region|county|state_or_province|state_province)/i;
const REGION_LABEL =
  /(?:\bstate\b|\bprovince\b|\bregion\b|\bcounty\b|\bstate[\s._-]*\/[\s._-]*province\b|\bd[eé]partement\b|\bestado\b|\bprovincia\b|\bbundesland\b|都道府県|\bобласть\b|\b지역\b)/iu;

// --- Country --------------------------------------------------------------

const COUNTRY_ATTR = /(?:^|[_\-\s.[])(?:country(?:_name|_code)?|nation|pays)/i;
const COUNTRY_LABEL =
  /(?:\bcountry(?:[\s._-]*name)?\b|\bnation\b|\bpays\b|\bpa[ií]s\b|\bpaese\b|\bland\b|国|\bстрана\b|\b국가\b)/iu;

// --- Postal code ----------------------------------------------------------

const POSTAL_ATTR = /(?:^|[_\-\s.[])(?:zip(?:_code|code)?|postal[_\-\s.]*code|postcode|post[_\-\s.]*code|zipcode|plz|pin[_\-\s.]*code)/i;
const POSTAL_LABEL =
  /(?:\bzip(?:[\s._-]*code)?\b|\bpostal[\s._-]*code\b|\bpost[\s._-]*code\b|\bpostcode\b|\bplz\b|\bcp\b|\bcap\b|\bcodice[\s._-]*postale\b|郵便番号|\bпочтовый[\s._-]*индекс\b|\b우편번호\b)/iu;

/**
 * Evaluated in declaration order. Line2 before Line1 to prevent "line 2"
 * from being shadowed. Postal/city/region/country are orthogonal.
 */
export const ADDRESS_RULES: ReadonlyArray<AddressRule> = [
  {
    id: 'mozilla/address/line2',
    fieldType: 'address-line2',
    attr: LINE2_ATTR,
    label: LINE2_LABEL,
  },
  {
    id: 'mozilla/address/line1',
    fieldType: 'address-line1',
    attr: LINE1_ATTR,
    label: LINE1_LABEL,
    exclude: LINE1_EXCLUDE,
  },
  {
    id: 'mozilla/address/city',
    fieldType: 'address-city',
    attr: CITY_ATTR,
    label: CITY_LABEL,
  },
  {
    id: 'mozilla/address/region',
    fieldType: 'address-region',
    attr: REGION_ATTR,
    label: REGION_LABEL,
  },
  {
    id: 'mozilla/address/country',
    fieldType: 'address-country',
    attr: COUNTRY_ATTR,
    label: COUNTRY_LABEL,
  },
  {
    id: 'mozilla/address/postal',
    fieldType: 'address-postal',
    attr: POSTAL_ATTR,
    label: POSTAL_LABEL,
  },
];
