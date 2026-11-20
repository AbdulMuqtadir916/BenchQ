"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { isEditable } from "@/lib/derive/autofill";
import { statusOf, topicOf, type AutofillSection } from "@/lib/derive/autofill-view";
import type { AutofillEntry } from "@/lib/schemas/resume-autofill";
import type { ResumeSectionKey } from "@/lib/schemas/resume-document";
import { AddQuestion } from "./add-question";
import { AutofillRow, type SaveAutofill } from "./autofill-row";
import { TOPIC_ICONS } from "./topic-icons";

type AutofillSectionCardProps = {
  section: AutofillSection;
  /** Every entry of the version: a new question is checked against them all. */
  entries: readonly AutofillEntry[];
  canEdit: boolean;
  isSaving: boolean;
  onSave: SaveAutofill;
  onEditInBuilder: (section: ResumeSectionKey) => void;
  /** One of BenchQ's questions picked from Add a question: its row opens its editor. */
  openKey: string | null;
  onOpened: () => void;
  onPickQuestion: (key: string) => void;
};

/** Self-identification, then screening, then the rest, in the list Add a question offers. */
const PERSONAL_ORDER: Partial<Record<AutofillSection["id"], number>> = { "self-id": 2, screening: 1 };
const personalFirst = (entry: AutofillEntry) => PERSONAL_ORDER[topicOf(entry)] ?? 0;

const HINTS: Partial<Record<AutofillSection["id"], string>> = {
  review: "The resume or the profile changed an answer you had written. Keep yours, or take the new one.",
  custom: "Questions forms ask that BenchQ doesn't, with your answers. The extension fills them wherever a form asks the same.",
};

/** One topic of the Autofill tab, as a card: its icon, title and counts, then its questions. "Your questions" holds Add
 * a question. */
export function AutofillSectionCard({ section, entries, canEdit, isSaving, onSave, onEditInBuilder, openKey, onOpened, onPickQuestion }: AutofillSectionCardProps) {
  const [isAdding, setIsAdding] = useState(false);
  const Icon = TOPIC_ICONS[section.id];
  const missing = section.entries.filter((entry) => statusOf(entry) === "missing").length;
  const isReview = section.id === "review";
  const isCustom = section.id === "custom";
  const titleId = `autofill-${section.id}-title`;

  return (
    <section id={`autofill-${section.id}`} aria-labelledby={titleId} className={cn("scroll-mt-14 overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface)] shadow-[var(--shadow-xs)]",
      isReview ? "border-[var(--color-warning-fg)]" : "border-[var(--color-border)]")}>
      <header className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-4 py-2.5", isReview ? "bg-[var(--color-warning-bg)]" : "bg-[var(--color-surface-2)]")}>
        <Icon size={15} aria-hidden className={isReview ? "text-[var(--color-warning-fg)]" : "text-[var(--color-text-3)]"} />
        <h3 id={titleId} className="text-h3 text-[var(--color-text)]">{section.title}</h3>
        <span className="tabular text-caption text-[var(--color-text-3)]">{section.entries.length}</span>
        {missing > 0 ? <span className="text-caption text-[var(--color-warning-fg)]">{missing} to answer</span> : null}
        {isCustom && canEdit && !isAdding ? (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setIsAdding(true)}>
            <Plus size={14} aria-hidden />Add a question
          </Button>
        ) : null}
        {HINTS[section.id] ? <p className="w-full text-caption text-[var(--color-text-3)]">{HINTS[section.id]}</p> : null}
      </header>
      {isCustom && isAdding ? (
        <AddQuestion entries={entries} isSaving={isSaving} onSave={onSave} onDone={() => setIsAdding(false)}
          // BenchQ's questions with no answer yet, the personal ones first: picking one opens its own editor.
          available={entries.filter((entry) => entry.key && statusOf(entry) === "missing" && isEditable(entry))
            .sort((left, right) => personalFirst(right) - personalFirst(left))}
          onPickQuestion={(key) => { setIsAdding(false); onPickQuestion(key); }} />
      ) : null}
      {section.entries.length > 0 ? (
        <ul className="divide-y divide-[var(--color-border)]">
          {section.entries.map((entry) => (
            <AutofillRow key={entry.key ?? `own:${entry.question}`} entry={entry} entries={entries} canEdit={canEdit} isSaving={isSaving} onSave={onSave} onEditInBuilder={onEditInBuilder}
              isOpened={openKey !== null && openKey === entry.key} onOpened={onOpened} />
          ))}
        </ul>
      ) : isCustom && !isAdding ? (
        <p className="px-4 py-5 text-sm text-[var(--color-text-3)]">
          No questions of your own yet. Add the ones forms keep asking, like “Why do you want to work here?”
        </p>
      ) : null}
    </section>
  );
}
