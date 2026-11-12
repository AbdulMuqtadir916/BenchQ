"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { linesToTrim, MAX_FIT_STEP } from "@/lib/resume-doc/fit";
import { packPages, type PageItem } from "@/lib/resume-doc/paginate";
import { markFocus, restoreFocus, type FocusMark } from "./keep-focus";
import { measurePaper } from "./measure";

interface Layout {
  pages: PageItem[][] | null;
  /** The Fit-to-one-page step the paper renders at (lib/resume-doc/fit.ts); 0 is the template as designed. */
  step: number;
  /** With Fit to one page on and the minimums reached: about how many lines are left over. */
  overflowLines: number | null;
}

interface Options {
  isEnabled: boolean;
  fitOnePage: boolean;
  /** Anything that changes what the paper holds or how it's set (the document, the template). */
  inputs: readonly unknown[];
  measureRef: RefObject<HTMLDivElement | null>;
  /** The Two Column template's side column, measured and packed on its own beside the main column. */
  asideRef?: RefObject<HTMLDivElement | null>;
  pagesRef: RefObject<HTMLDivElement | null>;
  onLayout?: (result: { printedPages: number; overflowLines: number | null }) => void;
}

const SLACK_PX = 1;
const sameInputs = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const samePages = (a: PageItem[][] | null, b: PageItem[][]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Measures the off-screen copy after every render and packs its blocks onto pages. With Fit to one page on, it first
 * steps the type and spacing down (one render per step, before paint) until the résumé fits one page or the minimums
 * are reached. Inputs changing, or web fonts finishing loading, start the search again from the template's sizes.
 */
export function usePaperLayout({ isEnabled, fitOnePage, inputs, measureRef, asideRef, pagesRef, onLayout }: Options): Layout {
  const [layout, setLayout] = useState<Layout>({ pages: null, step: 0, overflowLines: null });
  const [fontsVersion, setFontsVersion] = useState(0);
  const lastInputs = useRef<readonly unknown[]>([]);
  /** The caret to put back once `pages` (the layout it was taken for) is on screen. */
  const focusMark = useRef<{ mark: FocusMark; pages: PageItem[][] } | null>(null);

  // Metrics measured before the web fonts load are wrong: measure again once they're in, and whenever more load.
  useEffect(() => {
    if (!isEnabled || typeof document === "undefined" || !document.fonts) return;
    let isLive = true;
    const bump = () => isLive && setFontsVersion((v) => v + 1);
    void document.fonts.ready.then(bump);
    document.fonts.addEventListener("loadingdone", bump);
    return () => {
      isLive = false;
      document.fonts.removeEventListener("loadingdone", bump);
    };
  }, [isEnabled]);

  useLayoutEffect(() => {
    const flow = measureRef.current;
    const aside = asideRef?.current ?? null;
    if (!isEnabled || !flow) return;
    const measure = () => {
      const measured = measurePaper(flow);
      if (!measured) return;
      const side = aside ? measurePaper(aside) : null;
      const was = layout;
      const key = [...inputs, fitOnePage, fontsVersion];
      const isNew = !sameInputs(lastInputs.current, key);
      lastInputs.current = key;

      // A pixel of slack: sub-pixel positions round differently on the real sheet than in the measuring copy.
      const pageHeight = measured.pageHeight - SLACK_PX;
      const sideHeight = side ? side.pageHeight - SLACK_PX : 0;
      const overflow = Math.max(measured.contentHeight - pageHeight, side ? side.contentHeight - sideHeight : 0);
      const tooTall = overflow > 0;
      let step = was.step;
      if (!fitOnePage || (isNew && step !== 0)) step = 0;
      else if (tooTall && step < MAX_FIT_STEP) step += 1;
      if (step !== was.step) {
        setLayout({ ...was, step });
        return;
      }

      const overflowLines = fitOnePage && tooTall ? linesToTrim(overflow, measured.lineHeight) : null;
      // The main column's pages and the side column's, sheet by sheet (their block ids never overlap).
      const main = packPages(measured.blocks, pageHeight);
      const sidePages = side ? packPages(side.blocks, sideHeight) : [];
      const pages = Array.from({ length: Math.max(main.length, sidePages.length) }, (_, i) => [...(main[i] ?? []), ...(sidePages[i] ?? [])]);
      if (samePages(was.pages, pages) && was.overflowLines === overflowLines) return;
      if (!samePages(was.pages, pages)) {
        const mark = markFocus(pagesRef.current);
        focusMark.current = mark ? { mark, pages } : null;
      }
      setLayout({ pages, step, overflowLines });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(flow);
    if (aside) observer.observe(aside);
    return () => observer.disconnect();
  });

  useLayoutEffect(() => {
    if (!layout.pages) return;
    const pending = focusMark.current;
    if (pending?.pages === layout.pages) {
      focusMark.current = null;
      restoreFocus(pagesRef.current, pending.mark);
    }
    if (!onLayout || !pagesRef.current) return;
    // A sheet that runs over (a block too tall to split) prints on more than one page: count what will print.
    const sheets = [...pagesRef.current.querySelectorAll<HTMLElement>(":scope > .rt")];
    const paperHeight = sheets[0] ? parseFloat(getComputedStyle(sheets[0]).getPropertyValue("--paper-height")) : 0;
    const printedPages = paperHeight ? sheets.reduce((n, s) => n + Math.max(1, Math.ceil((s.offsetHeight - 1) / paperHeight)), 0) : layout.pages.length;
    onLayout({ printedPages, overflowLines: layout.overflowLines });
  }, [layout, onLayout, pagesRef]);

  return layout;
}
