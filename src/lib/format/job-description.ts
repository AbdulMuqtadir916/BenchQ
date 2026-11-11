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
/** A fact: "Location: Lansing, MI (Hybrid)": a label of up to four words, then a short value. */
const FACT = /^([A-Za-z][A-Za-z/&()'-]*(?: [A-Za-z/&()'-]+){0,3}):\s+(.{1,120})$/;
/** A line that is already a list item: "- x", "• x", "* x", "1. x", "2) x". */
const MARKED = /^(?:[-•*·▪●]|\d{1,2}[.)])\s+(.+)$/;
/** Under a heading, a line this short is one item of its list; a longer one is a paragraph of its own. */
const ITEM_MAX = 220;

export function describeJob(text: string): DescriptionBlock[] {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks: DescriptionBlock[] = [];
  let underHeading = false;
  const last = () => blocks[blocks.length - 1];
  const addBullet = (item: string) => {
    const block = last();
    if (block?.kind === "bullets") block.items.push(item);
    else blocks.push({ kind: "bullets", items: [item] });
  };

  for (const line of lines) {
    const marked = MARKED.exec(line);
    if (marked) {
      addBullet(marked[1]!);
      continue;
    }
    if (HEADING.test(line)) {
      blocks.push({ kind: "heading", text: line.slice(0, -1).trim() });
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
  return blocks;
}
