/**
 * Semantic field mapper.
 *
 * Given FieldSignals for a control, produce the best (kind, confidence)
 * match, in priority order: the autocomplete attribute (standards-based, near
 * certain), then input type hints and weighted keyword/phrase matching across
 * the signals.
 */
import { TAXONOMY, type FieldKind, type KindSpec } from './taxonomy';
import { type FieldSignals, normalize, tokenize, similarity } from './signals';

interface MappingResult {
  kind: FieldKind;
  confidence: number; // 0..1
}

/** Per-signal weights: how much a keyword hit in each signal is worth. */
const SIGNAL_WEIGHTS: Array<{ key: keyof FieldSignals; weight: number }> = [
  { key: 'label', weight: 1.0 },
  { key: 'ariaLabel', weight: 0.95 },
  { key: 'placeholder', weight: 0.85 },
  { key: 'name', weight: 0.8 },
  { key: 'id', weight: 0.7 },
  { key: 'nearbyText', weight: 0.55 },
  { key: 'sectionHeading', weight: 0.3 },
  { key: 'className', weight: 0.35 },
  { key: 'dataAttrs', weight: 0.35 },
];

function scoreAgainstSpec(signals: FieldSignals, spec: KindSpec): number {
  let best = 0;

  for (const { key, weight } of SIGNAL_WEIGHTS) {
    const raw = signals[key];
    if (typeof raw !== 'string' || !raw) continue;
    const norm = normalize(raw);
    if (!norm) continue;
    const tokens = tokenize(raw);
    const joined = tokens.join('');

    let signalScore = 0;

    // Phrase hit: strongest evidence within a signal.
    for (const phrase of spec.phrases) {
      if (norm.includes(phrase)) {
        signalScore = Math.max(signalScore, 1.0);
        break;
      }
    }

    // Keyword hit: token equality, or containment for compound tokens.
    if (signalScore < 1) {
      for (const kw of spec.keywords) {
        if (tokens.includes(kw) || joined === kw) {
          signalScore = Math.max(signalScore, 0.9);
          break;
        }
        if (kw.length >= 4 && joined.includes(kw)) {
          signalScore = Math.max(signalScore, 0.75);
        }
      }
    }

    // Fuzzy layer for unusual namings ("candidatemailid" ≈ "emailaddress").
    if (signalScore < 0.6) {
      for (const kw of spec.keywords) {
        if (kw.length < 4) continue;
        const sim = similarity(joined, kw);
        if (sim > 0.72) signalScore = Math.max(signalScore, sim * 0.7);
      }
    }

    // Negative tokens veto this signal's contribution.
    if (signalScore > 0 && spec.negative) {
      for (const neg of spec.negative) {
        if (norm.includes(neg)) {
          signalScore = 0;
          break;
        }
      }
    }

    best = Math.max(best, signalScore * weight);
  }

  // Input-type hint adds corroboration but never stands alone for
  // ambiguous types; email/tel/date types are strong on their own.
  if (spec.inputTypes?.includes(signals.inputType)) {
    best = Math.max(best, signals.inputType === 'text' ? best : 0.85);
  }

  return Math.min(best, 1);
}

/** Map one field. Pure & synchronous, safe to call in tight loops. */
export function mapField(signals: FieldSignals): MappingResult {
  // Standard autocomplete attribute: canonical kind.
  const ac = normalize(signals.autocomplete).replace(/\s/g, '-');
  if (ac && ac !== 'off' && ac !== 'on') {
    for (const spec of TAXONOMY) {
      // autocomplete can carry section prefixes: "section-x shipping tel".
      if (spec.autocomplete.some((a) => ac === a || ac.endsWith(`-${a}`) || ac.includes(a))) {
        return { kind: spec.kind, confidence: 0.98 };
      }
    }
  }

  // Taxonomy scoring across all kinds.
  let bestSpec: (typeof TAXONOMY)[number] | null = null;
  let bestScore = 0;
  for (const spec of TAXONOMY) {
    const s = scoreAgainstSpec(signals, spec);
    if (s > bestScore) {
      bestScore = s;
      bestSpec = spec;
    }
  }

  if (bestSpec && bestScore > 0.3) {
    return { kind: bestSpec.kind, confidence: bestScore };
  }
  return { kind: 'unknown', confidence: 0 };
}
