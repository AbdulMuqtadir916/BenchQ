/**
 * FieldSignals: everything we know about a form control.
 */
export interface FieldSignals {
  label: string;        // <label> text (for= or wrapping)
  placeholder: string;
  name: string;
  id: string;
  ariaLabel: string;    // aria-label / aria-labelledby / aria-describedby text
  autocomplete: string;
  inputType: string;    // input type / 'select' / 'textarea' / 'radio' / 'checkbox'
  nearbyText: string;   // preceding sibling / parent cell text
  sectionHeading: string; // nearest heading / fieldset legend above the field
  className: string;
  dataAttrs: string;    // joined data-* attribute names+values
}

/** Normalize a raw string: lowercase, split camelCase & snake/kebab, strip noise. */
export function normalize(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase → camel Case
    .toLowerCase()
    .replace(/[_\-.\\/[\]:*]+/g, ' ')
    .replace(/[^a-z0-9\s@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(raw: string): string[] {
  const n = normalize(raw);
  return n ? n.split(' ') : [];
}

/** Dice coefficient over character bigrams — cheap fuzzy similarity (0..1). */
export function similarity(a: string, b: string): number {
  const x = normalize(a).replace(/\s/g, '');
  const y = normalize(b).replace(/\s/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const c = grams.get(g) ?? 0;
    if (c > 0) {
      hits++;
      grams.set(g, c - 1);
    }
  }
  return (2 * hits) / (x.length + y.length - 2);
}
