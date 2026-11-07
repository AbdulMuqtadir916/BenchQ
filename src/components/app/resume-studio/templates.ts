/**
 * Resume templates. Visual values live in globals.css under `.rt-*`;
 * this registry only names them and says which layout each one uses.
 * Ids match the fixture templateIds so existing resumes open in their template.
 */
export interface ResumeTemplate {
  id: string;
  name: string;
  description: string;
  className: string;
  layout: "single" | "sidebar";
}

export const RESUME_TEMPLATES: ResumeTemplate[] = [
  { id: "template_classic", name: "Classic Serif", description: "Centered header, serif type, ruled sections", className: "rt-classic", layout: "single" },
  { id: "template_modern", name: "Modern", description: "Clean sans-serif with blue section headings", className: "rt-modern", layout: "single" },
  { id: "template_minimal", name: "Minimal", description: "Quiet headings and generous whitespace", className: "rt-minimal", layout: "single" },
  { id: "template_executive", name: "Executive", description: "Serif name, navy rules, senior-level feel", className: "rt-executive", layout: "single" },
  { id: "template_compact", name: "Compact", description: "Tighter type to fit more on one page", className: "rt-compact", layout: "single" },
  { id: "template_sidebar", name: "Two Column", description: "Contact and skills in a side column", className: "rt-sidebar", layout: "sidebar" },
];

export function templateById(id: string): ResumeTemplate {
  return RESUME_TEMPLATES.find((t) => t.id === id) ?? RESUME_TEMPLATES[0]!;
}

export function stepTemplate(id: string, dir: -1 | 1): ResumeTemplate {
  const i = RESUME_TEMPLATES.findIndex((t) => t.id === id);
  const next = (Math.max(i, 0) + dir + RESUME_TEMPLATES.length) % RESUME_TEMPLATES.length;
  return RESUME_TEMPLATES[next]!;
}
