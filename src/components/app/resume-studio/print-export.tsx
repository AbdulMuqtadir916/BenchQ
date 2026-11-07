"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { ResumePaper } from "./paper/resume-paper";

/**
 * Export PDF through the browser's print dialog ("Save as PDF"). A clean,
 * non-editable copy of the page is portalled to <body> only while printing;
 * the print stylesheet in globals.css hides everything else.
 */
/** `fileName` is what "Save as PDF" offers (the page title while printing). */
export function usePrintExport(doc: ResumeDocument | null, fileName: string) {
  const [isPrinting, setPrinting] = useState(false);

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
            <ResumePaper doc={doc} />
          </div>,
          document.body,
        )
      : null;

  return { print: () => setPrinting(true), portal };
}
