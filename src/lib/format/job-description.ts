/**
 * A job description as blocks to lay out (docs/02 §6.z, decided 2026-11-11). Real postings arrive as plain
 * paragraphs, one line each, with no markup for headings or lists ("Required Skills:" is just another line). This
 * reads the structure the text already has, the way the mock postings were written: a short line ending in ":" is a
 * heading, the short lines under it are its bullets, short "Label: value" lines before any heading are the job's
 * facts, and lines that already start with a bullet stay bullets. Nothing is added or reworded.
 */
export type DescriptionBlock =
  | { kind: "facts"; items: Array<{ label: string; value: string }> }
  | { kind: "heading"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "paragraph"; text: string };

/** A heading: a short line that ends in ":" ("Job Description:", "Required Skills:"). */
const HEADING = /^[^:]{2,60}:$/;
/** A heading without its colon: two to five Title Case words and no closing punctuation ("Key Responsibilities"). */
const TITLE_HEADING = /^(?:[A-Z][\w'&/()-]*|&|and|of|to|for|the|a|an|in|on|with|or)(?: (?:[A-Z][\w'&/()-]*|&|and|of|to|for|the|a|an|in|on|with|or)){1,4}$/;
/** One-word headings postings use ("Responsibilities", "Qualifications"). */
const WORD_HEADING = /^(?:Responsibilities|Requirements|Qualifications|Skills|Benefits|Overview|Summary|Description|Duties|Education|Experience|Compensation|Perks|About)$/;
/** A fact: "Location: Lansing, MI (Hybrid)": a label of up to four words, then a short value. */
const FACT = /^([A-Za-z][A-Za-z/&()'-]*(?: [A-Za-z/&()'-]+){0,3}):\s+(.{1,120})$/;
/** A line that is already a list item: "- x", "• x", "* x", "1. x", "2) x". */
const MARKED = /^(?:[-•*·▪●]|\d{1,2}[.)])\s+(.+)$/;
/** Under a heading, a line this short is one item of its list; a longer one is a paragraph of its own. */
const ITEM_MAX = 300;

export function describeJob(text: string): DescriptionBlock[] {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks: DescriptionBlock[] = [];
  let underHeading = false;
  /** Lists whose items were marked in the text ("- x"): kept as lists even with one item. */
  const marked = new Set<DescriptionBlock>();
  const last = () => blocks[blocks.length - 1];
  const addBullet = (item: string, isMarked = false) => {
    const block = last();
    if (block?.kind === "bullets") block.items.push(item);
    else blocks.push({ kind: "bullets", items: [item] });
    if (isMarked) marked.add(last()!);
  };

  for (const line of lines) {
    const item = MARKED.exec(line);
    if (item) {
      addBullet(item[1]!, true);
      continue;
    }
    if (HEADING.test(line) || isPlainHeading(line)) {
      blocks.push({ kind: "heading", text: line.replace(/:$/, "").trim() });
      underHeading = true;
      continue;
    }
    const fact = underHeading ? null : FACT.exec(line);
    if (fact) {
      const block = last();
      const item = { label: fact[1]!, value: fact[2]! };
      if (block?.kind === "facts") block.items.push(item);
      else blocks.push({ kind: "facts", items: [item] });
      continue;
    }
    if (underHeading && line.length <= ITEM_MAX) {
      addBullet(line);
      continue;
    }
    blocks.push({ kind: "paragraph", text: line });
  }
  // A heading followed by a single unmarked line ("Role Overview", then its paragraph) is a paragraph, not a list.
  return blocks.map((block) => (block.kind === "bullets" && block.items.length === 1 && !marked.has(block) ? { kind: "paragraph", text: block.items[0]! } : block));
}

/** A heading written without its colon: Title Case, short, not a sentence, and not one of the job's facts. */
function isPlainHeading(line: string): boolean {
  if (line.length > 40 || /[.,;!?:]$/.test(line) || /\d/.test(line)) return false;
  return WORD_HEADING.test(line) || TITLE_HEADING.test(line);
}

