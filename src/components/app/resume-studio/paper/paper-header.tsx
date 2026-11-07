"use client";

import type { ReactNode } from "react";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { EditableText } from "../editable-text";
import { useDocActions } from "../use-doc-actions";

export function PaperName({ doc, editable, children }: { doc: ResumeDocument; editable: boolean; children?: ReactNode }) {
  const a = useDocActions();
  return (
    <header className="rt-header" data-rt-section="header">
      <EditableText className="rt-name" value={doc.fullName} onChange={(v) => a.setTop("fullName", v)} editable={editable} label="Full name" />
      {editable || doc.title ? (
        <EditableText className="rt-title" value={doc.title} onChange={(v) => a.setTop("title", v)} editable={editable} label="Title" placeholder="Headline, e.g. Senior Java Developer" />
      ) : null}
      {children}
    </header>
  );
}

const PRINTED = [
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "github", label: "GitHub" },
] as const;

/** The contact line: the location (city, state, country), then phone, email, LinkedIn, GitHub. Work authorization is not printed. */
export function PaperContacts({ doc, editable }: { doc: ResumeDocument; editable: boolean }) {
  const a = useDocActions();
  const h = doc.header;
  const place = [h.city, h.state, h.country].filter((p) => p.trim());
  const shown = PRINTED.filter((f) => editable || h[f.key].trim());
  if (!place.length && !shown.length && !editable) return null;
  return (
    <div className="rt-contacts">
      {editable ? (
        <span className="rt-contact">
          <EditableText value={h.city} onChange={(v) => a.setHeader("city", v)} editable label="City" placeholder="City" />
          {", "}
          <EditableText value={h.state} onChange={(v) => a.setHeader("state", v)} editable label="State" placeholder="State" />
          {", "}
          <EditableText value={h.country} onChange={(v) => a.setHeader("country", v)} editable label="Country" placeholder="Country" />
        </span>
      ) : place.length ? <span className="rt-contact">{place.join(", ")}</span> : null}
      {shown.map((f) => (
        <span key={f.key} className="rt-contact">
          <EditableText value={h[f.key]} onChange={(v) => a.setHeader(f.key, v)} editable={editable} label={f.label} placeholder={f.label} />
        </span>
      ))}
    </div>
  );
}
