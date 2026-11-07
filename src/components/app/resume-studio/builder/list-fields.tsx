"use client";

import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { newText, newId } from "@/lib/resume-doc/build";
import { Input } from "@/components/ui/input";
import { useDocActions } from "../use-doc-actions";
import { AddButton, EmptyHint, RowControls, TextField, moveHandlers } from "./fields";
import { BulletFields } from "./bullet-fields";

const card = "rounded-[var(--radius-md)] border border-[var(--color-border)] p-3";

export function SkillsFields({ doc }: { doc: ResumeDocument }) {
  const a = useDocActions();
  return (
    <>
      {doc.skills.length === 0 ? <EmptyHint title="No skills yet" /> : null}
      <ul className="space-y-2">
        {doc.skills.map((row, i) => (
          <li key={row.id} className="flex items-center gap-2">
            <Input className="w-36 shrink-0 font-[550]" aria-label={`Skill category ${i + 1}`} value={row.category} onChange={(e) => a.patch("skills", row.id, { category: e.target.value })} placeholder="Category" />
            <Input aria-label={`Skills in ${row.category || `row ${i + 1}`}`} value={row.items} onChange={(e) => a.patch("skills", row.id, { items: e.target.value })} placeholder="Java, Spring Boot, Kafka" />
            <RowControls label={`${row.category || "skill"} row`} onRemove={() => a.remove("skills", row.id)} {...moveHandlers(i, doc.skills.length, (d) => a.move("skills", row.id, d))} />
          </li>
        ))}
      </ul>
      <AddButton onClick={() => a.add("skills", { id: newId("skills"), category: "", items: "" })}>Add skill row</AddButton>
    </>
  );
}

export function EducationFields({ doc }: { doc: ResumeDocument }) {
  const a = useDocActions();
  return (
    <>
      {doc.education.length === 0 ? <EmptyHint title="No education yet" /> : null}
      {doc.education.map((e) => (
        <div key={e.id} className={card}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="School" value={e.school} onChange={(v) => a.patch("education", e.id, { school: v })} />
            <TextField label="Degree" value={e.degree} onChange={(v) => a.patch("education", e.id, { degree: v })} />
            <TextField label="Graduation" value={e.graduationDate} onChange={(v) => a.patch("education", e.id, { graduationDate: v })} placeholder="Jun 2019" />
            <TextField label="Grade" value={e.grade} onChange={(v) => a.patch("education", e.id, { grade: v })} placeholder="CGPA 8.9 (optional)" />
          </div>
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => a.remove("education", e.id)} className="text-sm text-[var(--color-text-3)] hover:text-[var(--color-danger-fg)]">Remove</button>
          </div>
        </div>
      ))}
      <AddButton onClick={() => a.add("education", { id: newId("edu"), school: "", degree: "", graduationDate: "", grade: "" })}>Add education</AddButton>
    </>
  );
}

/** Certifications and awards: the same four fields (name, issuer, date, and a short detail). */
export function CredentialFields({ doc, section }: { doc: ResumeDocument; section: "certifications" | "awards" }) {
  const a = useDocActions();
  const one = section === "certifications" ? "certification" : "award";
  const rows = doc[section];
  return (
    <>
      {rows.length === 0 ? <EmptyHint title={`No ${section} yet`} /> : null}
      {rows.map((c, i) => (
        <div key={c.id} className={card}>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem_6rem]">
            <TextField label="Name" value={c.name} onChange={(v) => a.patch(section, c.id, { name: v })} placeholder={section === "certifications" ? "AWS Solutions Architect" : "Employee of the Year"} />
            <TextField label="Issuer" value={c.issuer} onChange={(v) => a.patch(section, c.id, { issuer: v })} />
            <TextField label="Date" value={c.date} onChange={(v) => a.patch(section, c.id, { date: v })} placeholder="2023" />
          </div>
          <div className="mt-3 flex items-end gap-2">
            <TextField className="flex-1" label="Detail" value={c.detail} onChange={(v) => a.patch(section, c.id, { detail: v })} placeholder="Optional, short" />
            <RowControls label={c.name || `${one} ${i + 1}`} onRemove={() => a.remove(section, c.id)} {...moveHandlers(i, rows.length, (d) => a.move(section, c.id, d))} />
          </div>
        </div>
      ))}
      <AddButton onClick={() => a.add(section, { id: newId(section === "certifications" ? "cert" : "award"), name: "", issuer: "", date: "", detail: "" })}>Add {one}</AddButton>
    </>
  );
}

export function ProjectFields({ doc }: { doc: ResumeDocument }) {
  const a = useDocActions();
  return (
    <>
      {doc.projects.length === 0 ? <EmptyHint title="No projects yet" /> : null}
      {doc.projects.map((p, i) => (
        <div key={p.id} className={`${card} space-y-3`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Project name" value={p.name} onChange={(v) => a.patch("projects", p.id, { name: v })} />
            <TextField label="Link" value={p.link} onChange={(v) => a.patch("projects", p.id, { link: v })} placeholder="github.com/… (optional)" />
            <TextField label="Dates" value={p.dates} onChange={(v) => a.patch("projects", p.id, { dates: v })} placeholder="2023" />
            <TextField label="Technologies" value={p.technologies} onChange={(v) => a.patch("projects", p.id, { technologies: v })} placeholder="Go, Kafka" />
          </div>
          <BulletFields section="projects" entryId={p.id} bullets={p.bullets} />
          <div className="flex justify-end">
            <RowControls label={p.name || `project ${i + 1}`} onRemove={() => a.remove("projects", p.id)} {...moveHandlers(i, doc.projects.length, (d) => a.move("projects", p.id, d))} />
          </div>
        </div>
      ))}
      <AddButton onClick={() => a.add("projects", { id: newId("proj"), name: "", link: "", dates: "", technologies: "", bullets: [newText()] })}>Add project</AddButton>
    </>
  );
}
