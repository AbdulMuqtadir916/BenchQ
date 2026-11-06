"use client";

import { AlignLeft, Award, BadgeCheck, Briefcase, FolderGit2, GraduationCap, IdCard, Layers } from "lucide-react";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { SECTION_ORDER, type OrderedSection } from "@/lib/resume-doc/section-order";
import { BuilderSection } from "./builder-section";
import { HeaderFields, SummaryFields } from "./header-summary";
import { ExperienceFields } from "./experience-fields";
import { CredentialFields, EducationFields, ProjectFields, SkillsFields } from "./list-fields";

const FORM: Record<OrderedSection, { title: string; icon: typeof IdCard; count?: (doc: ResumeDocument) => number; Fields: (props: { doc: ResumeDocument }) => React.ReactNode }> = {
  summary: { title: "Summary", icon: AlignLeft, Fields: SummaryFields },
  skills: { title: "Skills", icon: Layers, count: (d) => d.skills.length, Fields: SkillsFields },
  experience: { title: "Experience", icon: Briefcase, count: (d) => d.experience.length, Fields: ExperienceFields },
  awards: { title: "Awards", icon: Award, count: (d) => d.awards.length, Fields: ({ doc }) => <CredentialFields doc={doc} section="awards" /> },
  projects: { title: "Projects", icon: FolderGit2, count: (d) => d.projects.length, Fields: ProjectFields },
  education: { title: "Education", icon: GraduationCap, count: (d) => d.education.length, Fields: EducationFields },
  certifications: { title: "Certifications", icon: BadgeCheck, count: (d) => d.certifications.length, Fields: ({ doc }) => <CredentialFields doc={doc} section="certifications" /> },
};

/** Builder mode's left pane: the header, then every section as a collapsible form, in the page's order. */
export function BuilderPanel({ doc }: { doc: ResumeDocument }) {
  return (
    <div className="space-y-2.5">
      <BuilderSection id="header" title="Header" icon={IdCard}>
        <HeaderFields doc={doc} />
      </BuilderSection>
      {SECTION_ORDER.map((key) => {
        const { title, icon, count, Fields } = FORM[key];
        return (
          <BuilderSection key={key} id={key} title={title} icon={icon} count={count?.(doc)}>
            <Fields doc={doc} />
          </BuilderSection>
        );
      })}
    </div>
  );
}
