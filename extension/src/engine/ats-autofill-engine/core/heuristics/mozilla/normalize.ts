// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Original: https://searchfox.org/mozilla-central/source/toolkit/components/formautofill/
// Modifications: ported to TypeScript + standalone, 2026 Ebenezer Isaac

/**
 * Pure string normalization helpers. Ported from Firefox formautofill
 * `_getNormalizedString` and friends.
 *
 * Every function is deterministic and side-effect-free. No I/O, no DOM, no
 * host-platform APIs. Input of null/undefined collapses to empty string.
 */

/**
 * Replace control chars (incl. null byte), collapse whitespace, lowercase,
 * trim. Used on every signal before regex matching so the rule tables can be
 * written as lowercase keyword fragments.
 */
export function normalize(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let s: string;
  try {
    s = String(raw);
  } catch {
    return '';
  }
  if (s.length === 0) return '';
  // Strip C0 controls + DEL + C1 controls (0x00-0x1F, 0x7F, 0x80-0x9F) and
  // replace with space so adjacent letters remain distinguishable.
  // Then collapse any whitespace run to a single space.
  const controlStripped = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
  return controlStripped.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Strip diacritics (e, a, o, c with combining marks) for ASCII-fold matching.
 * Uses NFD decomposition + combining-mark removal, then recomposes back to NFC
 * so precomposed CJK / Hangul syllables survive the round-trip. Without the
 * NFC recompose, Hangul syllables like "이" decompose into jamo sequences
 * that break literal-character matching in rule regex tables.
 */
export function stripDiacritics(s: string): string {
  if (!s) return '';
  return s.normalize('NFD').replace(/[\u0300-\u036F]/g, '').normalize('NFC');
}

/**
 * Normalize a signal then strip diacritics. Used for label matching where the
 * user may type "nombre" while the rule table lists "nombré". Cheap enough to
 * run per-call without memoization since rule matching is O(rules) dominant.
 */
export function canonicalize(raw: string | null | undefined): string {
  return stripDiacritics(normalize(raw));
}
