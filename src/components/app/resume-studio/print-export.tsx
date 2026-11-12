"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { ResumePaper } from "./paper/resume-paper";
import { useStudio } from "./studio-store";

/**
 * Export PDF through the browser's print dialog ("Save as PDF"). A clean,
 * non-editable copy of the page is portalled to <body> only while printing;
 * the print stylesheet in globals.css hides everything else.
 */
/**
 * `fileName` is what "Save as PDF" offers (the page title while printing). `fitOnePage` defaults to the open
 * résumé's setting in the studio; a download from outside the studio passes its own.
 */
export function usePrintExport(doc: ResumeDocument | null, fileName: string, fitOverride?: boolean) {
  const [isPrinting, setPrinting] = useState(false);
  const studioFit = useStudio((s) => s.fitOnePage);
  const fitOnePage = fitOverride ?? studioFit;

  useEffect(() => {
    if (!isPrinting || !doc) return;
    const previousTitle = document.title;
    document.title = fileName;
    const frame = requestAnimationFrame(() => {
      window.print();
      document.title = previousTitle;
      setPrinting(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [isPrinting, doc, fileName]);

  const portal =
    isPrinting && doc && typeof document !== "undefined"
      ? createPortal(
          <div className="rt-print-portal">
            <ResumePaper doc={doc} fitOnePage={fitOnePage} />
          </div>,
          document.body,
        )
      : null;

  return { print: () => setPrinting(true), portal };
}
