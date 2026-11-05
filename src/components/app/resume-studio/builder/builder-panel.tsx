"use client";

import { AlignLeft, Award, BadgeCheck, Briefcase, FolderGit2, GraduationCap, IdCard, Layers } from "lucide-react";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { BuilderSection } from "./builder-section";
import { HeaderFields, SummaryFields } from "./header-summary";
import { ExperienceFields } from "./experience-fields";
import { CredentialFields, EducationFields, ProjectFields, SkillsFields } from "./list-fields";

/** Builder mode's left pane — every section as a collapsible form. */
export function BuilderPanel({ doc }: { doc: ResumeDocument }) {
  return (
    <div className="space-y-2.5">
      <BuilderSection id="header" title="Header" icon={IdCard}>
        <HeaderFields doc={doc} />
      </BuilderSection>
      <BuilderSection id="summary" title="Summary" icon={AlignLeft}>
        <SummaryFields doc={doc} />
      </BuilderSection>
      <BuilderSection id="experience" title="Experience" icon={Briefcase} count={doc.experience.length}>
        <ExperienceFields doc={doc} />
      </BuilderSection>
      <BuilderSection id="skills" title="Skills" icon={Layers} count={doc.skills.length}>
        <SkillsFields doc={doc} />
      </BuilderSection>
      <BuilderSection id="education" title="Education" icon={GraduationCap} count={doc.education.length}>
        <EducationFields doc={doc} />
      </BuilderSection>
      <BuilderSection id="certifications" title="Certifications" icon={BadgeCheck} count={doc.certifications.length}>
        <CredentialFields doc={doc} section="certifications" />
      </BuilderSection>
      <BuilderSection id="awards" title="Awards" icon={Award} count={doc.awards.length}>
        <CredentialFields doc={doc} section="awards" />
      </BuilderSection>
      <BuilderSection id="projects" title="Projects" icon={FolderGit2} count={doc.projects.length}>
        <ProjectFields doc={doc} />
      </BuilderSection>
    </div>
  );
}
