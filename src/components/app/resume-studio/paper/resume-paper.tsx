"use client";

import { useCallback, useRef, useSyncExternalStore, type CSSProperties, type Ref } from "react";
import { createPortal } from "react-dom";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { cn } from "@/lib/cn";
import { FIT_STEPS } from "@/lib/resume-doc/fit";
import { itemsById } from "@/lib/resume-doc/paginate";
import { SECTION_ORDER, type OrderedSection } from "@/lib/resume-doc/section-order";
import { PaperMeasureContext } from "../editable-text";
import { templateById, type ResumeTemplate } from "../templates";
import { useStudio } from "../studio-store";
import { PaperContacts, PaperName } from "./paper-header";
import { PaperAwards, PaperCertifications, PaperEducation, PaperExperience, PaperProjects, PaperSkills, PaperSummary, type BlockProps } from "./paper-sections";
import { usePaperLayout } from "./use-paper-layout";

interface ResumePaperProps {
  doc: ResumeDocument;
  /** Inline editing on the page (Viewer mode). */
  editable?: boolean;
  /** The main preview reports its page count to the toolbar; thumbnails don't. */
  reportPages?: boolean;
  /** Thumbnails show one unpaginated sheet (only its top is visible). */
  paginate?: boolean;
  /** Shrink type and spacing, down to fixed minimums, to fit one page (lib/resume-doc/fit.ts). */
  fitOnePage?: boolean;
  templateId?: string;
  className?: string;
}

const PAPER_SECTION: Record<OrderedSection, (props: BlockProps) => React.ReactNode> = {
  summary: PaperSummary,
  skills: PaperSkills,
  experience: PaperExperience,
  awards: PaperAwards,
  projects: PaperProjects,
  education: PaperEducation,
  certifications: PaperCertifications,
};

/** The sections in SECTION_ORDER, leaving out any the template places elsewhere. */
function Sections({ skip = [], ...blocks }: BlockProps & { skip?: readonly OrderedSection[] }) {
  return SECTION_ORDER.filter((key) => !skip.includes(key)).map((key) => {
    const Section = PAPER_SECTION[key];
    return <Section key={key} {...blocks} />;
  });
}

/** One US Letter sheet holding the blocks in `only` (all of them when it's left out). */
function Sheet({ template, flowRef, asideRef, label, style, ...blocks }: BlockProps & { template: ResumeTemplate; flowRef?: Ref<HTMLDivElement>; asideRef?: Ref<HTMLDivElement>; label: string; style?: CSSProperties }) {
  const hasHeader = !blocks.only || blocks.only.has("header");
  const hasContact = !blocks.only || blocks.only.has("contact");
  return (
    <article className={cn("rt", template.className)} aria-label={label} style={style}>
      {template.layout === "sidebar" ? (
        <div className="rt-cols">
          <aside>
            {/* The side column paginates on its own: contact, then skill rows (the heading with the first row). */}
            <div ref={asideRef} className="rt-flow">
              {hasContact ? (
                <section className="rt-section" data-rt-block="contact">
                  <h2 className="rt-h">Contact</h2>
                  <PaperContacts doc={blocks.doc} editable={blocks.editable} />
                </section>
              ) : null}
              {/* Skills, second in the order, sits beside the summary; the rest follow the order in the main column. */}
              <PaperSkills {...blocks} />
            </div>
          </aside>
          <div className="rt-main">
            <div ref={flowRef} className="rt-flow">
              {hasHeader ? <PaperName doc={blocks.doc} editable={blocks.editable} /> : null}
              <Sections {...blocks} skip={["skills"]} />
            </div>
          </div>
        </div>
      ) : (
        <div ref={flowRef} className="rt-flow">
          {hasHeader ? (
            <PaperName doc={blocks.doc} editable={blocks.editable}>
              <PaperContacts doc={blocks.doc} editable={blocks.editable} />
            </PaperName>
          ) : null}
          <Sections {...blocks} />
        </div>
      )}
    </article>
  );
}

const noSubscribe = () => () => {};

/**
 * The résumé as US Letter sheets in the chosen template. An off-screen copy is measured block by block and the
 * blocks are packed onto pages (resume-doc/paginate.ts), so nothing is cut by a page break except a long job or
 * project between its bullets. The preview and the PDF export both render this, with the same Fit-to-one-page setting.
 */
export function ResumePaper({ doc, editable = false, reportPages = false, paginate = true, fitOnePage = false, templateId, className }: ResumePaperProps) {
  const template = templateById(templateId ?? doc.templateId);
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const measureRef = useRef<HTMLDivElement>(null);
  const asideMeasureRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const setPageCount = useStudio((s) => s.setPageCount);
  const setFitOverflowLines = useStudio((s) => s.setFitOverflowLines);
  const onLayout = useCallback(
    ({ printedPages, overflowLines }: { printedPages: number; overflowLines: number | null }) => {
      setPageCount(printedPages);
      setFitOverflowLines(overflowLines);
    },
    [setPageCount, setFitOverflowLines],
  );
  const { pages, step } = usePaperLayout({
    isEnabled: paginate,
    fitOnePage,
    inputs: [doc, template.id, editable],
    measureRef,
    asideRef: asideMeasureRef,
    pagesRef,
    onLayout: reportPages ? onLayout : undefined,
  });

  const name = `${doc.fullName || "Resume"} — ${template.name} template`;
  const fit = FIT_STEPS[step] ?? FIT_STEPS[0]!;
  // Computed scale factors for the CSS (globals.css applies them with their floors).
  const fitStyle = step ? ({ "--rt-fit-type": fit.type, "--rt-fit-space": fit.space, "--rt-fit-leading": fit.leading } as CSSProperties) : undefined;
  const blocks = { doc, editable, template, style: fitStyle };
  const layout = paginate && pages ? pages : [null];

  return (
    <div ref={pagesRef} className={cn("rt-pages flex flex-col gap-6", className)} role="group" aria-label={name}>
      {layout.map((items, i) => (
        <Sheet key={i} {...blocks} only={items ? itemsById(items) : undefined} label={`Page ${i + 1} of ${layout.length}`} />
      ))}
      {paginate && isClient
        ? createPortal(
            <div className="rt-measure" aria-hidden="true" inert>
              <PaperMeasureContext.Provider value>
                <Sheet {...blocks} flowRef={measureRef} asideRef={asideMeasureRef} label="" />
              </PaperMeasureContext.Provider>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
