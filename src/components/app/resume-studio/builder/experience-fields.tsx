"use client";

import { ChevronRight } from "lucide-react";
import type { ExperienceEntry, ResumeDocument } from "@/lib/schemas/resume-document";
import { newText, newId } from "@/lib/resume-doc/build";
import { cn } from "@/lib/cn";
import { Checkbox } from "@/components/ui/checkbox";
import { useDocActions } from "../use-doc-actions";
import { useStudio } from "../studio-store";
import { AddButton, EmptyHint, RowControls, TextField, moveHandlers } from "./fields";
import { BulletFields } from "./bullet-fields";

export function ExperienceFields({ doc }: { doc: ResumeDocument }) {
  const a = useDocActions();
  const toggleEntry = useStudio((s) => s.toggleEntry);

  function addExperience() {
    const id = newId("exp");
    a.add("experience", { id, company: "", title: "", location: "", dates: "", start: "", end: "", current: false, bullets: [newText()] });
    toggleEntry(id, true);
  }

  return (
    <>
      {doc.experience.length === 0 ? <EmptyHint title="No experience yet" /> : null}
      {doc.experience.map((e, i) => (
        <ExperienceItem key={e.id} entry={e} controls={moveHandlers(i, doc.experience.length, (d) => a.move("experience", e.id, d))} />
      ))}
      <AddButton onClick={addExperience}>Add experience</AddButton>
    </>
  );
}

function ExperienceItem({ entry: e, controls }: { entry: ExperienceEntry; controls: { onUp?: () => void; onDown?: () => void } }) {
  const a = useDocActions();
  const isOpen = useStudio((s) => !!s.openEntries[e.id]);
  const toggleEntry = useStudio((s) => s.toggleEntry);
  const label = e.title || e.company || "new role";

  return (
    <div className={cn("rounded-[var(--radius-md)] border", isOpen ? "border-[var(--color-border-strong)]" : "border-[var(--color-border)]")}>
      <div className="flex items-center gap-2 pr-1">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => toggleEntry(e.id)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] px-3 text-left"
        >
          <ChevronRight size={13} aria-hidden className={cn("shrink-0 text-[var(--color-text-3)] transition-transform", isOpen && "rotate-90")} />
          <span className="min-w-0 flex-1 truncate text-body-strong text-[var(--color-text)]">{e.title || "Untitled role"}</span>
          <span className="hidden min-w-0 max-w-[30%] truncate text-sm text-[var(--color-text-3)] sm:inline">{e.company}</span>
          <span className="hidden shrink-0 text-sm text-[var(--color-text-3)] md:inline">{e.dates}</span>
          <span className="tabular shrink-0 text-caption text-[var(--color-text-3)]">{e.bullets.length} bullets</span>
        </button>
        <RowControls label={label} onRemove={() => a.remove("experience", e.id)} {...controls} />
      </div>
      {isOpen ? (
        <div className="space-y-3 border-t border-[var(--color-border)] p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Company" value={e.company} onChange={(v) => a.patch("experience", e.id, { company: v })} />
            <TextField label="Title" value={e.title} onChange={(v) => a.patch("experience", e.id, { title: v })} />
            <TextField label="Location" value={e.location} onChange={(v) => a.patch("experience", e.id, { location: v })} placeholder="City, State or Remote" />
            <TextField label="Dates" value={e.dates} onChange={(v) => a.patch("experience", e.id, { dates: v })} placeholder="Jan 2022 – Present" />
          </div>
          <div className="grid items-end gap-3 sm:grid-cols-3">
            <TextField label="Start" value={e.start} onChange={(v) => a.patch("experience", e.id, { start: v })} placeholder="2022-01" />
            <TextField label="End" value={e.end} onChange={(v) => a.patch("experience", e.id, { end: v })} placeholder="2024-06" />
            <label className="flex min-h-9 items-center gap-2 text-sm text-[var(--color-text-2)]">
              <Checkbox checked={e.current} onChange={(ev) => a.patch("experience", e.id, { current: ev.target.checked, end: ev.target.checked ? "" : e.end })} />
              Current role
            </label>
          </div>
          <BulletFields section="experience" entryId={e.id} bullets={e.bullets} />
        </div>
      ) : null}
    </div>
  );
}
