"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, LayoutTemplate, Minus, Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { cn } from "@/lib/cn";
import { stepTemplate, templateById } from "../templates";
import { ResumePaper } from "../paper/resume-paper";
import { useStudio } from "../studio-store";
import { TemplateGallery } from "./template-gallery";

const ZOOM_STEPS = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5];
const iconBtn = "inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-40";

/** The desk: toolbar, template gallery and the zoomable page. Viewer mode passes `editable`. */
export function PreviewPane({ doc, editable = false, aside }: { doc: ResumeDocument; editable?: boolean; aside?: ReactNode }) {
  const deskRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const { zoom, setZoom, galleryOpen, setGalleryOpen, setTemplate, pageCount } = useStudio();
  const template = templateById(doc.templateId);
  const scale = zoom === "fit" ? fitScale : zoom;

  useLayoutEffect(() => {
    const desk = deskRef.current;
    if (!desk) return;
    const paperWidth = parseFloat(getComputedStyle(desk).getPropertyValue("--paper-width")) || 1;
    const measure = () => setFitScale(Math.min(1.15, Math.max(0.4, (desk.clientWidth - 64) / paperWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(desk);
    return () => observer.disconnect();
  }, []);

  function stepZoom(dir: -1 | 1) {
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > scale + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < scale - 0.001);
    if (next) setZoom(next);
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5">
        <div className="flex items-center gap-1">
          <LayoutTemplate size={14} aria-hidden className="text-[var(--color-text-3)]" />
          <span className="mr-1 text-sm text-[var(--color-text-3)]">Template</span>
          <button type="button" className={iconBtn} onClick={() => setTemplate(stepTemplate(doc.templateId, -1).id)} aria-label="Previous template" title="Previous template  [">
            <ChevronLeft size={15} aria-hidden />
          </button>
          <button
            type="button"
            aria-expanded={galleryOpen}
            onClick={() => setGalleryOpen(!galleryOpen)}
            className="bq-select-trigger inline-flex h-7 min-w-36 items-center justify-between gap-2 rounded-[var(--radius-md)] px-2.5 text-sm font-[550]"
          >
            {template.name}
            <ChevronDown size={13} aria-hidden className={cn("text-[var(--color-text-3)] transition-transform", galleryOpen && "rotate-180")} />
          </button>
          <button type="button" className={iconBtn} onClick={() => setTemplate(stepTemplate(doc.templateId, 1).id)} aria-label="Next template" title="Next template  ]">
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button type="button" className={iconBtn} onClick={() => stepZoom(-1)} disabled={scale <= ZOOM_STEPS[0]!} aria-label="Zoom out"><Minus size={14} aria-hidden /></button>
          <button
            type="button"
            onClick={() => setZoom("fit")}
            aria-pressed={zoom === "fit"}
            title="Fit page to width"
            className={cn("tabular h-7 min-w-16 rounded-[var(--radius-sm)] px-2 text-sm", zoom === "fit" ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]" : "text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)]")}
          >
            {zoom === "fit" ? "Fit · " : ""}{Math.round(scale * 100)}%
          </button>
          <button type="button" className={iconBtn} onClick={() => stepZoom(1)} disabled={scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]!} aria-label="Zoom in"><Plus size={14} aria-hidden /></button>
        </div>

        <span className="tabular text-sm text-[var(--color-text-3)]" aria-live="polite">{pageCount} {pageCount === 1 ? "page" : "pages"} · US Letter</span>
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>

      <AnimatePresence initial={false}>{galleryOpen ? <TemplateGallery doc={doc} /> : null}</AnimatePresence>

      <div ref={deskRef} className="rs-desk min-h-0 flex-1 overflow-auto" data-studio-desk="">
        <div className="flex min-w-fit justify-center px-8 py-8">
          <div style={{ zoom: scale }}>
            <ResumePaper doc={doc} editable={editable} reportPages />
          </div>
        </div>
      </div>
    </div>
  );
}
