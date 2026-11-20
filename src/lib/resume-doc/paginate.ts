/**
 * Résumé pagination. The paper is cut into blocks (the header, the summary, each skill row, each job, project,
 * education row, award and certification; a section heading travels with its section's first block). Blocks are
 * measured in an off-screen copy of the page, then packed. A block that doesn't fit in what is left of a page moves
 * to the next one, unless it is a job or project that can split between bullets: then as much as fits stays, as
 * long as at least MIN_SPLIT bullets stay on each side. The title, subtitle and tech line always stay with the
 * first bullets, so a heading is never left alone at the bottom of a page.
 */

/** Where a block sits in the measured flow, in CSS px from the top of the flow. */
export interface MeasuredBlock {
  id: string;
  top: number;
  bottom: number;
  /** Its bullets, in order, for blocks that may split between them. */
  bullets?: ReadonlyArray<{ top: number; bottom: number }>;
}

/** A block on a page: whole, or the bullets [from, to) of a split one (the part with `from` 0 carries the head). */
export interface PageItem {
  id: string;
  from?: number;
  to?: number;
}

/** Bullets kept together on each side of a split. */
export const MIN_SPLIT = 2;

/**
 * Packs blocks onto pages of `pageHeight` px of content. Every step places at least one part of a block, so it
 * always ends. A part that fits on no page by itself (a block too tall, with no allowed split) gets a page of its
 * own and runs over it; nothing is clipped or dropped.
 */
export function packPages(blocks: readonly MeasuredBlock[], pageHeight: number): PageItem[][] {
  const pages: PageItem[][] = [];
  let page: PageItem[] = [];
  let start = 0;
  const closePage = () => {
    pages.push(page);
    page = [];
  };

  for (const block of blocks) {
    const bullets = block.bullets ?? [];
    const n = bullets.length;
    let from = 0;
    let top = block.top;
    const part = (to: number): PageItem => (from === 0 && to === n ? { id: block.id } : { id: block.id, from, to });

    for (;;) {
      if (!page.length) start = top;
      if (block.bottom - start <= pageHeight) {
        page.push(part(n));
        break;
      }
      let cut = -1;
      for (let k = n - MIN_SPLIT; k >= from + MIN_SPLIT; k--) {
        if (bullets[k - 1]!.bottom - start <= pageHeight) {
          cut = k;
          break;
        }
      }
      // Alone on a page and still too tall: cut at the first allowed point, so as little as possible runs over.
      if (cut < 0 && !page.length && n - from >= 2 * MIN_SPLIT) cut = from + MIN_SPLIT;
      if (cut > 0) {
        page.push(part(cut));
        closePage();
        from = cut;
        top = bullets[cut]!.top;
        continue;
      }
      if (page.length) {
        closePage();
        continue;
      }
      page.push(part(n));
      break;
    }
  }
  if (page.length || !pages.length) closePage();
  return pages;
}

/** The page's items by block id, for the sections to pick from. */
export function itemsById(items: readonly PageItem[]): ReadonlyMap<string, PageItem> {
  return new Map(items.map((item) => [item.id, item]));
}
