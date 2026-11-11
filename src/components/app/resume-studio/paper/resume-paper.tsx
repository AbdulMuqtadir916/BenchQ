"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { cn } from "@/lib/cn";
import { SECTION_ORDER, type OrderedSection } from "@/lib/resume-doc/section-order";
import { templateById } from "../templates";
import { useStudio } from "../studio-store";
import { PaperContacts, PaperName } from "./paper-header";
import { PaperAwards, PaperCertifications, PaperEducation, PaperExperience, PaperProjects, PaperSkills, PaperSummary } from "./paper-sections";

interface ResumePaperProps {
  doc: ResumeDocument;
  /** Inline editing on the page (Viewer mode). */
  editable?: boolean;
  /** The main preview reports its page count to the toolbar; thumbnails don't. */
  reportPages?: boolean;
  templateId?: string;
  className?: string;
}

const PAPER_SECTION: Record<OrderedSection, (props: { doc: ResumeDocument; editable: boolean }) => React.ReactNode> = {
  summary: PaperSummary,
  skills: PaperSkills,
  experience: PaperExperience,
  awards: PaperAwards,
  projects: PaperProjects,
  education: PaperEducation,
  certifications: PaperCertifications,
};

/** The sections in SECTION_ORDER, leaving out any the template places elsewhere. */
function Sections({ doc, editable, skip = [] }: { doc: ResumeDocument; editable: boolean; skip?: readonly OrderedSection[] }) {
  return SECTION_ORDER.filter((key) => !skip.includes(key)).map((key) => {
    const Section = PAPER_SECTION[key];
    return <Section key={key} doc={doc} editable={editable} />;
  });
}

/** A US Letter page rendered in the chosen template, with page-break guides. */
export function ResumePaper({ doc, editable = false, reportPages = false, templateId, className }: ResumePaperProps) {
  const template = templateById(templateId ?? doc.templateId);
  const paperRef = useRef<HTMLElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const setPageCount = useStudio((s) => s.setPageCount);
  const [metrics, setMetrics] = useState({ pages: 1, pageHeight: 0 });

  useLayoutEffect(() => {
    const paper = paperRef.current;
    const flow = flowRef.current;
    if (!paper || !flow) return;
    const measure = () => {
      const style = getComputedStyle(paper);
      const pageHeight = parseFloat(style.getPropertyValue("--paper-height")) || 0;
      if (!pageHeight) return;
      const total = flow.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const pages = Math.max(1, Math.ceil((total - 1) / pageHeight));
      setMetrics((m) => (m.pages === pages && m.pageHeight === pageHeight ? m : { pages, pageHeight }));
      if (reportPages) setPageCount(pages);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(flow);
    return () => observer.disconnect();
  }, [reportPages, setPageCount, template.className]);

  const blocks = { doc, editable };

  return (
    <article
      ref={paperRef}
      className={cn("rt", template.className, className)}
      aria-label={`${doc.fullName || "Resume"} — ${template.name} template`}
      style={metrics.pageHeight ? { minHeight: metrics.pages * metrics.pageHeight } : undefined}
    >
      {template.layout === "sidebar" ? (
        <div ref={flowRef} className="rt-cols">
          <aside>
            <section className="rt-section">
              <h2 className="rt-h">Contact</h2>
              <PaperContacts {...blocks} />
            </section>
            {/* Skills, second in the order, sits beside the summary; the rest follow the order in the main column. */}
            <PaperSkills {...blocks} />
          </aside>
          <div>
            <PaperName {...blocks} />
            <Sections {...blocks} skip={["skills"]} />
          </div>
        </div>
      ) : (
        <div ref={flowRef}>
          <PaperName {...blocks}>
            <PaperContacts {...blocks} />
          </PaperName>
          <Sections {...blocks} />
        </div>
      )}
      {Array.from({ length: metrics.pages - 1 }, (_, i) => (
        <div key={i} className="rt-break" style={{ top: (i + 1) * metrics.pageHeight }} aria-hidden="true">
          <span>Page {i + 2}</span>
        </div>
      ))}
    </article>
  );
}
