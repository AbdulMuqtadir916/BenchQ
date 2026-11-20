"use client";

import type { BulletSection, ResumeDocument, RichText } from "@/lib/schemas/resume-document";
import { newText } from "@/lib/resume-doc/build";
import type { PageItem } from "@/lib/resume-doc/paginate";
import { projectLink } from "@/lib/resume-doc/paper-links";
import { isBlank } from "@/lib/resume-doc/rich-text";
import type { OrderedSection } from "@/lib/resume-doc/section-order";
import { EditableText } from "../editable-text";
import { useDocActions } from "../use-doc-actions";
import { useStudio } from "../studio-store";
import { PaperAnchor } from "./paper-link";

/** The paper's jobs and projects: entries with bullets, which may split between pages (resume-doc/paginate.ts). */

/** A block's id: `header`, `summary`, or `<section>:<entry id>`. */
export const blockId = (section: OrderedSection, entryId: string) => `${section}:${entryId}`;

/** Blank text only shows while editing. */
export const shows = (t: RichText, editable: boolean) => editable || !isBlank(t.html);

/** This page's part of an entry: its bullet range, and whether its head is here. */
function partOf(section: BulletSection, entryId: string, only?: ReadonlyMap<string, PageItem>) {
  const item = only?.get(blockId(section, entryId));
  const from = item?.from ?? 0;
  return { hasHead: from === 0, range: item?.to === undefined ? undefined : ([from, item.to] as const) };
}

/** The bullets of one job or project, editable in place: Enter starts the next, Backspace in an empty one drops it. */
function PaperBullets({ section, entryId, bullets, editable, range }: { section: BulletSection; entryId: string; bullets: RichText[]; editable: boolean; range?: readonly [number, number] }) {
  const a = useDocActions();
  const requestFocus = useStudio((s) => s.requestFocus);
  const all = bullets.filter((b) => shows(b, editable));
  const visible = range ? all.slice(range[0], range[1]) : all;
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

export function ExperienceEntry({ e, editable, only }: { e: ResumeDocument["experience"][number]; editable: boolean; only?: ReadonlyMap<string, PageItem> }) {
  const a = useDocActions();
  const { hasHead, range } = partOf("experience", e.id, only);
  return (
    <div className="rt-entry" data-rt-block={blockId("experience", e.id)} data-rt-continued={hasHead ? undefined : ""}>
      {hasHead ? (
        <>
          <div className="rt-entry-head">
            <EditableText className="rt-role" value={e.title} onChange={(v) => a.patch("experience", e.id, { title: v })} editable={editable} label="Job title" />
            <EditableText className="rt-meta" value={e.dates} onChange={(v) => a.patch("experience", e.id, { dates: v })} editable={editable} label="Dates" />
          </div>
          <div className="rt-entry-head">
            <EditableText className="rt-org" value={e.company} onChange={(v) => a.patch("experience", e.id, { company: v })} editable={editable} label="Company" />
            {editable || e.location ? <EditableText className="rt-meta" value={e.location} onChange={(v) => a.patch("experience", e.id, { location: v })} editable={editable} label="Location" /> : null}
          </div>
        </>
      ) : null}
      <PaperBullets section="experience" entryId={e.id} bullets={e.bullets} editable={editable} range={range} />
    </div>
  );
}

export function ProjectEntry({ p, editable, only }: { p: ResumeDocument["projects"][number]; editable: boolean; only?: ReadonlyMap<string, PageItem> }) {
  const a = useDocActions();
  const { hasHead, range } = partOf("projects", p.id, only);
  return (
    <div className="rt-entry" data-rt-block={blockId("projects", p.id)} data-rt-continued={hasHead ? undefined : ""}>
      {hasHead ? (
        <>
          <div className="rt-entry-head">
            <EditableText className="rt-role" value={p.name} onChange={(v) => a.patch("projects", p.id, { name: v })} editable={editable} label="Project name" />
            {editable || p.dates ? <EditableText className="rt-meta" value={p.dates} onChange={(v) => a.patch("projects", p.id, { dates: v })} editable={editable} label="Project dates" placeholder="Dates" /> : null}
          </div>
          {editable || p.link || p.technologies ? (
            <div className="rt-entry-head">
              {editable || p.technologies ? <EditableText className="rt-org" value={p.technologies} onChange={(v) => a.patch("projects", p.id, { technologies: v })} editable={editable} label="Technologies" placeholder="Technologies" /> : <span />}
              {editable ? <EditableText className="rt-meta" value={p.link} onChange={(v) => a.patch("projects", p.id, { link: v })} editable label="Project link" placeholder="Link" />
                : p.link ? <PaperAnchor className="rt-meta" link={projectLink(p.link)} text={p.link} /> : null}
            </div>
          ) : null}
        </>
      ) : null}
      <PaperBullets section="projects" entryId={p.id} bullets={p.bullets} editable={editable} range={range} />
    </div>
  );
}
