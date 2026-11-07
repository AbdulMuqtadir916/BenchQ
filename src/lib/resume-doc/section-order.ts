import type { ResumeSectionKey } from "@/lib/schemas/resume-document";

/**
 * The order of a résumé's sections under its header, in every template, the Builder form and the Viewer outline
 * (decided 2026-11-06): summary, skills, work experience, awards, projects, education (degree), certifications.
 */
export const SECTION_ORDER = [
  "summary",
  "skills",
  "experience",
  "awards",
  "projects",
  "education",
  "certifications",
] as const satisfies readonly Exclude<ResumeSectionKey, "header">[];

export type OrderedSection = (typeof SECTION_ORDER)[number];
