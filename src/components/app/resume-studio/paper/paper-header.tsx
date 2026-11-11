"use client";

import { useId, type ReactNode } from "react";
import { isProfileLinkField, normalizeProfileLink, PROFILE_LINK_ERROR } from "@/lib/resume-doc/profile-link";
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

function PaperContact({ value, label, editable, isLink, onChange }: { value: string; label: string; editable: boolean; isLink: boolean; onChange: (value: string) => void }) {
  const id = useId();
  const normalized = isLink && editable ? normalizeProfileLink(value) : value;
  return (
    <span className="rt-contact">
      <EditableText value={value} onChange={onChange} editable={editable} label={label} placeholder={label}
        invalidDescriptionId={normalized === null ? id : undefined}
        onBlur={() => { if (normalized !== null && normalized !== value) onChange(normalized); }} />
      {normalized === null ? <span id={id} className="ml-1 text-caption text-[var(--color-danger-fg)]">{PROFILE_LINK_ERROR}</span> : null}
    </span>
  );
}

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
        <PaperContact key={f.key} value={h[f.key]} label={f.label} editable={editable} isLink={isProfileLinkField(f.key)}
          onChange={(v) => a.setHeader(f.key, v)} />
      ))}
    </div>
  );
}
