"use client";

import type { ReactNode } from "react";
import type { ResumeDocument, ResumeSectionKey } from "@/lib/schemas/resume-document";
import type { PageItem } from "@/lib/resume-doc/paginate";
import type { OrderedSection } from "@/lib/resume-doc/section-order";
import { EditableText } from "../editable-text";
import { useDocActions } from "../use-doc-actions";
import { blockId, ExperienceEntry, ProjectEntry, shows } from "./paper-entries";

export { blockId };

/**
 * `only`: the blocks on this page by id (resume-doc/paginate.ts); left out, every block renders whole. A section
 * prints its heading only on the page that holds its first block; a job or project split between pages prints its
 * head (title, company or tech line) with its first bullets only.
 */
export type BlockProps = { doc: ResumeDocument; editable: boolean; only?: ReadonlyMap<string, PageItem> };

/** The rows of a section on this page, and whether its heading is too. */
function pick<T extends { id: string }>(section: OrderedSection, rows: readonly T[], only?: ReadonlyMap<string, PageItem>) {
  const shown = only ? rows.filter((r) => only.has(blockId(section, r.id))) : [...rows];
  // The heading goes with the start of the first entry, not with the rest of it on a later page.
  const first = shown[0];
  const startsHere = !!first && first === rows[0] && (only?.get(blockId(section, first.id))?.from ?? 0) === 0;
  return { shown, hasHeading: startsHere };
}

function Section({ id, title, hasHeading = true, block, children }: { id: ResumeSectionKey; title: string; hasHeading?: boolean; block?: string; children: ReactNode }) {
  return (
    <section className="rt-section" data-rt-section={id} data-rt-block={block}>
      {hasHeading ? <h2 className="rt-h">{title}</h2> : null}
      {children}
    </section>
  );
}

export function PaperSummary({ doc, editable, only }: BlockProps) {
  const a = useDocActions();
  if (!shows(doc.summary, editable) || (only && !only.has("summary"))) return null;
  return (
    <Section id="summary" title="Summary" block="summary">
      <EditableText as="p" rich value={doc.summary.html} onChange={(v) => a.setTextHtml(doc.summary.id, v)} editable={editable} label="Summary" fieldId={doc.summary.id} />
    </Section>
  );
}

export function PaperExperience({ doc, editable, only }: BlockProps) {
  const { shown, hasHeading } = pick("experience", doc.experience, only);
  if (!shown.length) return null;
  return (
    <Section id="experience" title="Experience" hasHeading={hasHeading}>
      {shown.map((e) => <ExperienceEntry key={e.id} e={e} editable={editable} only={only} />)}
    </Section>
  );
}

export function PaperSkills({ doc, editable, only }: BlockProps) {
  const a = useDocActions();
  const { shown, hasHeading } = pick("skills", doc.skills, only);
  if (!shown.length) return null;
  return (
    <Section id="skills" title="Skills" hasHeading={hasHeading}>
      {shown.map((row) => (
        <div key={row.id} className="rt-skill-row" data-rt-block={blockId("skills", row.id)}>
          <EditableText className="rt-skill-cat" value={row.category} onChange={(v) => a.patch("skills", row.id, { category: v })} editable={editable} label="Skill category" />
          <span className="rt-skill-sep">: </span>
          <EditableText value={row.items} onChange={(v) => a.patch("skills", row.id, { items: v })} editable={editable} label="Skills" />
        </div>
      ))}
    </Section>
  );
}

export function PaperEducation({ doc, editable, only }: BlockProps) {
  const a = useDocActions();
  const { shown, hasHeading } = pick("education", doc.education, only);
  if (!shown.length) return null;
  return (
    <Section id="education" title="Education" hasHeading={hasHeading}>
      {shown.map((e) => (
        <div key={e.id} className="rt-entry" data-rt-block={blockId("education", e.id)}>
          <div className="rt-entry-head">
            <EditableText className="rt-role" value={e.school} onChange={(v) => a.patch("education", e.id, { school: v })} editable={editable} label="School" />
            <EditableText className="rt-meta" value={e.graduationDate} onChange={(v) => a.patch("education", e.id, { graduationDate: v })} editable={editable} label="Graduation" />
          </div>
          <div className="rt-entry-head">
            <EditableText className="rt-org" value={e.degree} onChange={(v) => a.patch("education", e.id, { degree: v })} editable={editable} label="Degree" />
            {editable || e.grade ? <EditableText className="rt-meta" value={e.grade} onChange={(v) => a.patch("education", e.id, { grade: v })} editable={editable} label="Grade" placeholder="Grade" /> : null}
          </div>
        </div>
      ))}
    </Section>
  );
}

function PaperCredentials({ doc, editable, only, section, title }: BlockProps & { section: "certifications" | "awards"; title: string }) {
  const a = useDocActions();
  const { shown, hasHeading } = pick(section, doc[section], only);
  if (!shown.length) return null;
  return (
    <Section id={section} title={title} hasHeading={hasHeading}>
      {shown.map((c) => (
        <div key={c.id} className="rt-entry" data-rt-block={blockId(section, c.id)}>
          <div className="rt-entry-head">
            <span>
              <EditableText className="rt-role" value={c.name} onChange={(v) => a.patch(section, c.id, { name: v })} editable={editable} label="Name" />
              {editable || c.issuer ? <>{" · "}<EditableText className="rt-org" value={c.issuer} onChange={(v) => a.patch(section, c.id, { issuer: v })} editable={editable} label="Issuer" placeholder="Issuer" /></> : null}
            </span>
            {editable || c.date ? <EditableText className="rt-meta" value={c.date} onChange={(v) => a.patch(section, c.id, { date: v })} editable={editable} label="Date" placeholder="Date" /> : null}
          </div>
          {editable || c.detail ? <EditableText className="rt-desc" value={c.detail} onChange={(v) => a.patch(section, c.id, { detail: v })} editable={editable} label="Detail" placeholder="Detail (optional)" /> : null}
        </div>
      ))}
    </Section>
  );
}

export const PaperCertifications = (props: BlockProps) => <PaperCredentials {...props} section="certifications" title="Certifications" />;
export const PaperAwards = (props: BlockProps) => <PaperCredentials {...props} section="awards" title="Awards" />;

export function PaperProjects({ doc, editable, only }: BlockProps) {
  const { shown, hasHeading } = pick("projects", doc.projects, only);
  if (!shown.length) return null;
  return (
    <Section id="projects" title="Projects" hasHeading={hasHeading}>
      {shown.map((p) => <ProjectEntry key={p.id} p={p} editable={editable} only={only} />)}
    </Section>
  );
}
