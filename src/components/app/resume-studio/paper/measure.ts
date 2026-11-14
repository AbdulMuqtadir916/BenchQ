import type { MeasuredBlock } from "@/lib/resume-doc/paginate";

export interface PaperMeasure {
  blocks: MeasuredBlock[];
  /** Content height of one page, in CSS px. */
  pageHeight: number;
  /** The full sheet height (`--paper-height`), in CSS px. */
  paperHeight: number;
  /** Height of all the content, as one column. */
  contentHeight: number;
  /** One line of body text, in CSS px. */
  lineHeight: number;
}

/**
 * Measures the off-screen copy of the paper: every `[data-rt-block]` in `flow`, in order, with the bullets of jobs
 * and projects (where they may split), and the content height of a page (the sheet's height less the padding between
 * the sheet and the flow). A section's first block starts at the section's top, so its heading travels with it.
 */
export function measurePaper(flow: HTMLElement): PaperMeasure | null {
  const sheet = flow.closest<HTMLElement>(".rt");
  // No layout boxes (the print stylesheet hides the copy): measuring now would read every block as 0px tall.
  if (!sheet || !flow.getClientRects().length) return null;
  const paperHeight = parseFloat(getComputedStyle(sheet).getPropertyValue("--paper-height"));
  if (!paperHeight) return null;

  let chrome = 0;
  for (let el: HTMLElement | null = flow; el; el = el === sheet ? null : el.parentElement) {
    const style = getComputedStyle(el);
    chrome += parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  }

  const origin = flow.getBoundingClientRect().top;
  const span = (el: Element) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top - origin, bottom: rect.bottom - origin };
  };
  const blocks = [...flow.querySelectorAll<HTMLElement>("[data-rt-block]")].map((el): MeasuredBlock => {
    const section = el.closest<HTMLElement>(".rt-section");
    const startsSection = section && section !== el && section.querySelector("[data-rt-block]") === el;
    const bullets = [...el.querySelectorAll(":scope > .rt-bullets > li")].map(span);
    return {
      id: el.dataset.rtBlock ?? "",
      top: span(startsSection ? section : el).top,
      bottom: span(el).bottom,
      ...(bullets.length ? { bullets } : {}),
    };
  });
  const style = getComputedStyle(flow);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  return { blocks, pageHeight: paperHeight - chrome, paperHeight, contentHeight: blocks.at(-1)?.bottom ?? 0, lineHeight };
}
