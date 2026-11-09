"use client";

import type { ResumeDocument, ResumeHeader } from "@/lib/schemas/resume-document";
import { stripTags } from "@/lib/resume-doc/rich-text";
import { useDocActions } from "../use-doc-actions";
import { FieldLabel, TextField } from "./fields";
import { RichField } from "./rich-field";

const CONTACT: Array<{ key: Exclude<keyof ResumeHeader, "workAuthorization">; label: string; placeholder: string }> = [
  { key: "email", label: "Email", placeholder: "name@example.com" },
  { key: "phone", label: "Phone", placeholder: "+1 214 555 0100" },
  { key: "city", label: "City", placeholder: "e.g. Dallas" },
  { key: "state", label: "State", placeholder: "e.g. TX" },
  { key: "country", label: "Country", placeholder: "e.g. US" },
  { key: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/…" },
  { key: "github", label: "GitHub", placeholder: "github.com/…" },
];

export function HeaderFields({ doc }: { doc: ResumeDocument }) {
  const a = useDocActions();
  return (
    <>
      <TextField label="Full name" value={doc.fullName} onChange={(v) => a.setTop("fullName", v)} />
      <TextField label="Title" value={doc.title} onChange={(v) => a.setTop("title", v)} placeholder="Headline, e.g. Senior Java Developer" />
      <div className="grid gap-3 sm:grid-cols-2">
        {CONTACT.map((f) => (
          <TextField key={f.key} label={f.label} value={doc.header[f.key]} onChange={(v) => a.setHeader(f.key, v)} placeholder={f.placeholder} />
        ))}
      </div>
      <div>
        <FieldLabel hint="from the candidate's profile">Work authorization</FieldLabel>
        <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-2)]">
          {doc.header.workAuthorization || "Not set"}
        </p>
      </div>
    </>
  );
}

export function SummaryFields({ doc }: { doc: ResumeDocument }) {
  const length = stripTags(doc.summary.html).length;
  return (
    <>
      <RichField field={doc.summary} label="Summary" placeholder="Two or three lines on who the candidate is and what they deliver" />
      <p className="tabular text-caption text-[var(--color-text-3)]">{length} characters{length > 450 ? " · recruiters skim — aim for under 450" : ""}</p>
    </>
  );
}
