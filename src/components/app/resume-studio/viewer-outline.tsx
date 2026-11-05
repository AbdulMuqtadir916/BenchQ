"use client";

import { AlignLeft, Award, BadgeCheck, Briefcase, FolderGit2, GraduationCap, IdCard, Layers, MousePointerClick, Sparkles, TextCursorInput } from "lucide-react";
import type { ResumeDocument, ResumeSectionKey } from "@/lib/schemas/resume-document";
import { isBlank } from "@/lib/resume-doc/rich-text";

const SECTIONS: Array<{ key: ResumeSectionKey; label: string; Icon: typeof IdCard }> = [
  { key: "header", label: "Header", Icon: IdCard },
  { key: "summary", label: "Summary", Icon: AlignLeft },
  { key: "experience", label: "Experience", Icon: Briefcase },
  { key: "skills", label: "Skills", Icon: Layers },
  { key: "education", label: "Education", Icon: GraduationCap },
  { key: "certifications", label: "Certifications", Icon: BadgeCheck },
  { key: "awards", label: "Awards", Icon: Award },
  { key: "projects", label: "Projects", Icon: FolderGit2 },
];

function isPresent(doc: ResumeDocument, key: ResumeSectionKey): boolean {
  if (key === "header") return true;
  if (key === "summary") return !isBlank(doc.summary.html);
  return doc[key].length > 0;
}

/** Viewer mode's slim left rail — jump around the page, plus how inline editing works. */
export function ViewerOutline({ doc }: { doc: ResumeDocument }) {
  function jump(key: ResumeSectionKey) {
    const target = document.querySelector<HTMLElement>(`[data-studio-desk] [data-rt-section="${key}"]`);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <aside aria-label="Resume outline" className="hidden w-56 shrink-0 flex-col justify-between overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:flex">
      <nav>
        <p className="mb-2 px-2 text-caption text-[var(--color-text-3)]">On this page</p>
        <ul className="space-y-0.5">
          {SECTIONS.filter((s) => isPresent(doc, s.key)).map(({ key, label, Icon }) => (
            <li key={key}>
              <button type="button" onClick={() => jump(key)} className="bq-nav-item w-full text-body">
                <Icon size={15} aria-hidden />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-6 space-y-2.5 rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-2)]">
        <p className="flex gap-2"><MousePointerClick size={14} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-text-3)]" />Click any text on the page to edit it.</p>
        <p className="flex gap-2"><TextCursorInput size={14} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-text-3)]" />Enter starts a new bullet. Backspace on an empty one removes it.</p>
        <p className="flex gap-2"><Sparkles size={14} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-violet-fg)]" />Select text to format it or ask AI to rewrite it (⌘J).</p>
      </div>
    </aside>
  );
}
