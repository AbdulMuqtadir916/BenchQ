"use client";

import { useEffect, useRef } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { cn } from "@/lib/cn";
import { EASE_OUT } from "@/lib/motion";
import { RESUME_TEMPLATES } from "../templates";
import { ResumePaper } from "../paper/resume-paper";
import { useStudio } from "../studio-store";

const THUMB_ZOOM = 0.2;

/** A strip of live thumbnails — every template rendered with this resume's real content. */
export function TemplateGallery({ doc }: { doc: ResumeDocument }) {
  const setTemplate = useStudio((s) => s.setTemplate);
  const stripRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);

  const scrollBy = (dir: -1 | 1) => stripRef.current?.scrollBy({ left: dir * 360, behavior: reduce ? "auto" : "smooth" });
  const arrow = "absolute top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[var(--radius-full)] bq-secondary";

  return (
    <motion.div
      initial={reduce ? false : { height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT }}
      className="overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <div className="relative px-10 py-3">
        <button type="button" className={cn(arrow, "left-2")} onClick={() => scrollBy(-1)} aria-label="Scroll templates left"><ChevronLeft size={15} aria-hidden /></button>
        <div ref={stripRef} role="group" aria-label="Templates" className="flex gap-3 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none]">
          {RESUME_TEMPLATES.map((t) => {
            const isActive = t.id === doc.templateId;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setTemplate(t.id)}
                className={cn(
                  "group shrink-0 rounded-[var(--radius-lg)] border p-2 text-left transition-colors",
                  isActive ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]",
                )}
              >
                <span className="relative block h-[calc(var(--paper-height)*0.16)] w-[calc(var(--paper-width)*0.2)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-paper)]" aria-hidden="true" inert>
                  <span className="block" style={{ zoom: THUMB_ZOOM }}>
                    <ResumePaper doc={doc} templateId={t.id} paginate={false} />
                  </span>
                  {isActive ? (
                    <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-full)] bg-[var(--color-primary)] text-[var(--color-primary-fg)]">
                      <Check size={12} />
                    </span>
                  ) : null}
                </span>
                <span className="mt-1.5 block text-sm font-[550] text-[var(--color-text)]">{t.name}</span>
                <span className="block w-[calc(var(--paper-width)*0.2)] truncate text-caption text-[var(--color-text-3)]">{t.description}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className={cn(arrow, "right-2")} onClick={() => scrollBy(1)} aria-label="Scroll templates right"><ChevronRight size={15} aria-hidden /></button>
      </div>
    </motion.div>
  );
}
