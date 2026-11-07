"use client";

import type { ReactNode } from "react";
import type { BulletSection, ResumeDocument, ResumeSectionKey, RichText } from "@/lib/schemas/resume-document";
import { newText } from "@/lib/resume-doc/build";
import { isBlank } from "@/lib/resume-doc/rich-text";
import { EditableText } from "../editable-text";
import { useDocActions } from "../use-doc-actions";
import { useStudio } from "../studio-store";

type BlockProps = { doc: ResumeDocument; editable: boolean };

/** Blank text only shows while editing. */
const shows = (t: RichText, editable: boolean) => editable || !isBlank(t.html);

function Section({ id, title, children }: { id: ResumeSectionKey; title: string; children: ReactNode }) {
  return (
    <section className="rt-section" data-rt-section={id}>
      <h2 className="rt-h">{title}</h2>
      {children}
    </section>
  );
}

export function PaperSummary({ doc, editable }: BlockProps) {
  const a = useDocActions();
  if (!shows(doc.summary, editable)) return null;
  return (
    <Section id="summary" title="Summary">
      <EditableText as="p" rich value={doc.summary.html} onChange={(v) => a.setTextHtml(doc.summary.id, v)} editable={editable} label="Summary" fieldId={doc.summary.id} />
    </Section>
  );
}

/** The bullets of one job or project, editable in place: Enter starts the next, Backspace in an empty one drops it. */
function PaperBullets({ section, entryId, bullets, editable }: { section: BulletSection; entryId: string; bullets: RichText[]; editable: boolean }) {
  const a = useDocActions();
  const requestFocus = useStudio((s) => s.requestFocus);
  const visible = bullets.filter((b) => shows(b, editable));
  if (!visible.length) return null;
  return (
    <ul className="rt-bullets">
      {visible.map((b) => (
        <EditableText
          key={b.id}
          as="li"
          rich
          value={b.html}
          onChange={(v) => a.setTextHtml(b.id, v)}
          editable={editable}
          label="Bullet"
          placeholder="Describe an outcome"
          fieldId={b.id}
          onEnter={() => {
            const next = newText();
            a.addBullet(section, entryId, next, b.id);
            requestFocus(next.id);
          }}
          onBackspaceEmpty={() => a.removeBullet(section, entryId, b.id)}
        />
      ))}
    </ul>
  );
}

export function PaperExperience({ doc, editable }: BlockProps) {
  const a = useDocActions();
  if (!doc.experience.length) return null;
  return (
    <Section id="experience" title="Experience">
      {doc.experience.map((e) => (
        <div key={e.id} className="rt-entry">
          <div className="rt-entry-head">
            <EditableText className="rt-role" value={e.title} onChange={(v) => a.patch("experience", e.id, { title: v })} editable={editable} label="Job title" />
            <EditableText className="rt-meta" value={e.dates} onChange={(v) => a.patch("experience", e.id, { dates: v })} editable={editable} label="Dates" />
          </div>
          <div className="rt-entry-head">
            <EditableText className="rt-org" value={e.company} onChange={(v) => a.patch("experience", e.id, { company: v })} editable={editable} label="Company" />
            {editable || e.location ? <EditableText className="rt-meta" value={e.location} onChange={(v) => a.patch("experience", e.id, { location: v })} editable={editable} label="Location" /> : null}
          </div>
          <PaperBullets section="experience" entryId={e.id} bullets={e.bullets} editable={editable} />
        </div>
      ))}
    </Section>
  );
}

export function PaperSkills({ doc, editable }: BlockProps) {
  const a = useDocActions();
  if (!doc.skills.length) return null;
  return (
    <Section id="skills" title="Skills">
      {doc.skills.map((row) => (
        <div key={row.id} className="rt-skill-row">
          <EditableText className="rt-skill-cat" value={row.category} onChange={(v) => a.patch("skills", row.id, { category: v })} editable={editable} label="Skill category" />
          <span className="rt-skill-sep">: </span>
          <EditableText value={row.items} onChange={(v) => a.patch("skills", row.id, { items: v })} editable={editable} label="Skills" />
        </div>
      ))}
    </Section>
  );
}

export function PaperEducation({ doc, editable }: BlockProps) {
  const a = useDocActions();
  if (!doc.education.length) return null;
  return (
    <Section id="education" title="Education">
      {doc.education.map((e) => (
        <div key={e.id} className="rt-entry">
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

function PaperCredentials({ doc, editable, section, title }: BlockProps & { section: "certifications" | "awards"; title: string }) {
  const a = useDocActions();
  const rows = doc[section];
  if (!rows.length) return null;
  return (
    <Section id={section} title={title}>
      {rows.map((c) => (
        <div key={c.id} className="rt-entry">
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

export function PaperProjects({ doc, editable }: BlockProps) {
  const a = useDocActions();
  if (!doc.projects.length) return null;
  return (
    <Section id="projects" title="Projects">
      {doc.projects.map((p) => (
        <div key={p.id} className="rt-entry">
          <div className="rt-entry-head">
            <EditableText className="rt-role" value={p.name} onChange={(v) => a.patch("projects", p.id, { name: v })} editable={editable} label="Project name" />
            {editable || p.dates ? <EditableText className="rt-meta" value={p.dates} onChange={(v) => a.patch("projects", p.id, { dates: v })} editable={editable} label="Project dates" placeholder="Dates" /> : null}
          </div>
          {editable || p.link || p.technologies ? (
            <div className="rt-entry-head">
              {editable || p.technologies ? <EditableText className="rt-org" value={p.technologies} onChange={(v) => a.patch("projects", p.id, { technologies: v })} editable={editable} label="Technologies" placeholder="Technologies" /> : <span />}
              {editable || p.link ? <EditableText className="rt-meta" value={p.link} onChange={(v) => a.patch("projects", p.id, { link: v })} editable={editable} label="Project link" placeholder="Link" /> : null}
            </div>
          ) : null}
          <PaperBullets section="projects" entryId={p.id} bullets={p.bullets} editable={editable} />
        </div>
      ))}
    </Section>
  );
}
